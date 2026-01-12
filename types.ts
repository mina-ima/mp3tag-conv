
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
  status: 'pending' | 'processing' | 'completed' | 'error';
  metadata?: AudioMetadata;
  fixedBlob?: Blob;
  error?: string;
}

export enum AppStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED'
}
