import { getBearerToken, validateJWT } from '../auth';
import { respondWithJSON } from './json';
import { getVideo, updateVideo } from '../db/videos';
import type { ApiConfig } from '../config';
import type { BunRequest } from 'bun';
import { BadRequestError, NotFoundError } from './errors';

type Thumbnail = {
	data: ArrayBuffer;
	mediaType: string;
};

const videoThumbnails: Map<string, Thumbnail> = new Map();

export async function handlerGetThumbnail(cfg: ApiConfig, req: BunRequest) {
	const { videoId } = req.params as { videoId?: string };
	if (!videoId) {
		throw new BadRequestError('Invalid video ID');
	}

	const video = getVideo(cfg.db, videoId);
	if (!video) {
		throw new NotFoundError("Couldn't find video");
	}

	const thumbnail = videoThumbnails.get(videoId);
	if (!thumbnail) {
		throw new NotFoundError('Thumbnail not found');
	}

	return new Response(thumbnail.data, {
		headers: {
			'Content-Type': thumbnail.mediaType,
			'Cache-Control': 'no-store',
		},
	});
}

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
	const { videoId } = req.params as { videoId?: string };
	if (!videoId) {
		throw new BadRequestError('Invalid video ID');
	}

	const token = getBearerToken(req.headers);
	const userID = validateJWT(token, cfg.jwtSecret);

	console.log('uploading thumbnail for video', videoId, 'by user', userID);

	const data = await req.formData();
	const file = data.get('thumbnail') as File | null;
	if (!file) {
		throw new BadRequestError('No thumbnail file provided');
	}

	const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10 MB

	if (file.size > MAX_UPLOAD_SIZE) {
		throw new BadRequestError('Thumbnail file is too large');
	}

	// Read all the image data into a ArrayBuffer
	const arrayBuffer = await file.arrayBuffer();

	// Get the video's metadata from the SQLite database
	const video = getVideo(cfg.db, videoId);
	if (!video) {
		throw new NotFoundError("Couldn't find video");
	}

	const thumbnail: Thumbnail = {
		data: arrayBuffer,
		mediaType: file.type,
	};

	// Store the thumbnail in the global map
	videoThumbnails.set(videoId, thumbnail);

	// Build the thumbnail URL in the format: http://localhost:<port>/api/thumbnails/:videoID
	const thumbnailURL = `http://localhost:${cfg.port}/api/thumbnails/${videoId}`;

	// Update the video metadata with the new thumbnail URL
	video.thumbnailURL = thumbnailURL;

	// Update the record in the database
	updateVideo(cfg.db, video);

	return respondWithJSON(200, video);
}
