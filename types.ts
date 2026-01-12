
export interface AudioMetadata {
  title?: string;
  artist?: string;
  album?: string;
  originalEncoding: 'UTF-8' | 'Shift-JIS' | 'Unknown';
}

export interface ProcessingFile {
  id: string;
  file: File;
  name: string;
  status: 'pending' | 'converting' | 'processing' | 'completed' | 'error';
  isWma: boolean;
  folderName?: string;
  metadata?: AudioMetadata;
  fixedBlob?: Blob;
  error?: string;
  progress?: number;
}

export enum AppStatus {
  IDLE = 'IDLE',
  LOADING_FFMPEG = 'LOADING_FFMPEG',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED'
}
