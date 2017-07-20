import ChunkManagerInterface from "./chunk-manager-interface";
import LoaderEvents from "./loader-events";
import LoaderFile from "./loader-file";
import LoaderInterface from "./loader-interface";
import Utils from "./utils";

const m3u8Parser = require("m3u8-parser");

export default class ChunkManager implements ChunkManagerInterface {

    private loader: LoaderInterface;
    private playlists: Map<string, Playlist> = new Map();
    private chunk: Chunk | null = null;

    public constructor(loader: LoaderInterface) {
        this.loader = loader;
        this.loader.on(LoaderEvents.FileLoaded, this.onFileLoaded.bind(this));
        this.loader.on(LoaderEvents.FileError, this.onFileError.bind(this));
    }

    public processHlsPlaylist(url: string, content: string): Playlist {
        const parser = new m3u8Parser.Parser();
        parser.push(content);
        parser.end();
        const playlist = new Playlist(url, parser.manifest);
        this.playlists.set(url, playlist);
        return playlist;
    }

    public async loadHlsPlaylist(url: string): Promise<string> {
        try {
            const content = await Utils.fetchContent(url);
            const playlist = this.processHlsPlaylist(url, content);
            if (playlist.limitedContentAvail()) {
                const limit = Math.trunc(playlist.manifest.segments.length / 2);
                return playlist.getLimitedContent(limit);
            } else {
                return content;
            }
        } catch (e) {
            this.playlists.delete(url);
            throw e;
        }
    }

    public loadChunk(url: string, onSuccess: Function, onError: Function): void {
        const files: LoaderFile[] = [];
        const { playlist, chunkIndex } = this.getChunkLocation(url);
        if (playlist) {
            const segments: any[] = playlist.manifest.segments;
            for (let i = chunkIndex; i < segments.length; ++i) {
                const fileUrl = playlist.baseUrl + segments[ i ].uri;
                files.push(new LoaderFile(fileUrl));
            }
        } else {
            files.push(new LoaderFile(url));
        }

        this.chunk = new Chunk(files[ 0 ].url, onSuccess, onError);
        this.loader.load(files, playlist ? playlist.url : url);
    }

    public abortChunk(url: string): void {
        if (this.chunk && this.chunk.url === url) {
            this.chunk = null;
        }
    }

    private onFileLoaded(file: LoaderFile): void {
        if (this.chunk && this.chunk.url === file.url) {
            if (this.chunk.onSuccess) {
                this.chunk.onSuccess(file.data);
            }
            this.chunk = null;
        }
    }

    private onFileError(url: string, error: any): void {
        if (this.chunk && this.chunk.url === url) {
            if (this.chunk.onError) {
                this.chunk.onError(error);
            }
            this.chunk = null;
        }
    }

    private getChunkLocation(url: string): { playlist: Playlist | null, chunkIndex: number } {
        for (const playlist of Array.from(this.playlists.values())) {
            const chunkIndex = playlist.getChunkIndex(url);
            if (chunkIndex >= 0) {
                return { playlist: playlist, chunkIndex: chunkIndex };
            }
        }

        return { playlist: null, chunkIndex: -1 };
    }

}

class Playlist {

    public url: string;
    public baseUrl: string;
    public manifest: any;

    public constructor(url: string, manifest: any) {
        this.url = url;
        this.manifest = manifest;

        const pos = url.lastIndexOf("/");
        if (pos === -1) {
            throw "Unexpected playlist URL format";
        }

        this.baseUrl = url.substring(0, pos + 1);
    }

    public getChunkIndex(url: string): number {
        for (let i = 0; i < this.manifest.segments.length; ++i) {
            if (url.endsWith(this.manifest.segments[ i ].uri)) {
                return i;
            }
        }

        return -1;
    }

    public limitedContentAvail(): boolean {
        const m = this.manifest;
        return !m.endList && m.segments.length > 0;
    }

    public getLimitedContent(limit: number): string {
        if (!this.limitedContentAvail()) {
            throw "Limited content allowed only for Live playlist with segments";
        }

        const m = this.manifest;
        let content = "#EXTM3U\n#EXT-X-VERSION:3\n";

        if (m.playlistType) {
            content += "#EXT-X-PLAYLIST-TYPE:" + m.playlistType + "\n";
        }

        if (m.targetDuration) {
            content += "#EXT-X-TARGETDURATION:" + m.targetDuration + "\n";
        }

        if (m.mediaSequence) {
            content += "#EXT-X-MEDIA-SEQUENCE:" + m.mediaSequence + "\n";
        }

        if (m.discontinuitySequence) {
            content += "#EXT-X-DISCONTINUITY-SEQUENCE:" + m.discontinuitySequence + "\n";
        }

        for (let i = 0; i < m.segments.length - limit; ++i) {
            const s = m.segments[ i ];
            content += "#EXTINF:" + s.duration + "\n";
            content += s.uri + "\n";
        }

        return content;
    }

}

class Chunk {

    public url: string;
    public onSuccess: Function;
    public onError: Function;

    public constructor(url: string, onSuccess: Function, onError: Function) {
        this.url = url;
        this.onSuccess = onSuccess;
        this.onError = onError;
    }

}