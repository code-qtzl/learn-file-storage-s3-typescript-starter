import { respondWithJSON } from './json';
import { getBearerToken, validateJWT } from '../auth';
import { getVideo, updateVideo } from '../db/videos';
import { BadRequestError, NotFoundError, UserForbiddenError } from './errors';
import { mediaTypeToExt } from './assets';
import { randomBytes } from 'crypto';
import { S3Client } from 'bun';

import { type ApiConfig } from '../config';
import type { BunRequest } from 'bun';

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
	// Step 1: Set upload limit of 1 GB
	const MAX_UPLOAD_SIZE = 1 << 30;

	// Step 2: Extract videoId from URL path parameters and parse as UUID
	const { videoId } = req.params as { videoId?: string };
	if (!videoId) {
		throw new BadRequestError('Invalid video ID');
	}

	// Step 3: Authenticate the user to get a userID
	const token = getBearerToken(req.headers);
	const userID = validateJWT(token, cfg.jwtSecret);

	// Step 4: Get video metadata from database and verify ownership
	const video = getVideo(cfg.db, videoId);
	if (!video) {
		throw new NotFoundError("Couldn't find video");
	}
	if (video.userID !== userID) {
		throw new UserForbiddenError('Not authorized to update this video');
	}

	// Step 5: Parse the uploaded video file from form data
	const formData = await req.formData();
	const file = formData.get('video');
	if (!(file instanceof File)) {
		throw new BadRequestError('Video file missing');
	}

	// Step 6: Check file size does not exceed upload limit
	if (file.size > MAX_UPLOAD_SIZE) {
		throw new BadRequestError(
			`Video file exceeds the maximum allowed size of 1GB`,
		);
	}

	// Step 7: Validate the uploaded file is an MP4 video
	const mediaType = file.type;
	if (mediaType !== 'video/mp4') {
		throw new BadRequestError(
			'Invalid file type. Only MP4 videos are supported',
		);
	}

	// Step 8: Save uploaded file to a temporary file on disk
	const tempFilePath = `/tmp/video-${randomBytes(16).toString('hex')}.mp4`;
	await Bun.write(tempFilePath, file);

	try {
		// Step 9: Put the object into S3
		const fileKey = `${randomBytes(32).toString('hex')}${mediaTypeToExt(mediaType)}`;
		const s3Client = new S3Client({
			bucket: cfg.s3Bucket,
			region: cfg.s3Region,
		});

		await s3Client.file(fileKey).write(Bun.file(tempFilePath));

		// Step 10: Update video metadata with S3 URL
		const videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${fileKey}`;
		video.videoURL = videoURL;
		updateVideo(cfg.db, video);

		return respondWithJSON(200, video);
	} finally {
		// Clean up temporary file
		await Bun.file(tempFilePath).delete();
	}
}
