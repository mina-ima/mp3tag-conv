
import React, { useState, useCallback, useRef } from 'react';
import { ProcessingFile, AppStatus } from './types.ts';
import { parseMetadata, fixFileTags } from './services/id3Service.ts';
import JSZip from 'jszip';

// Standard icons as functional components
const MusicIcon = () => (
  <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
  </svg>
);

const FolderIcon = () => (
  <svg className="w-6 h-6 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
  </svg>
);

const CheckCircleIcon = () => (
  <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
  </svg>
);

const ZipIcon = () => (
  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
  </svg>
);

const App: React.FC = () => {
  const [files, setFiles] = useState<ProcessingFile[]>([]);
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [isZipping, setIsZipping] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const processFileEntry = async (entry: FileSystemEntry, path: string = ''): Promise<ProcessingFile[]> => {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      return new Promise((resolve) => {
        fileEntry.file((file) => {
          if (file.type === 'audio/mpeg' || file.name.endsWith('.mp3')) {
            // path contains parent directory names
            const pathParts = path.split('/');
            const folderName = pathParts.length > 1 ? pathParts[pathParts.length - 2] : undefined;
            
            resolve([{
              id: Math.random().toString(36).substr(2, 9),
              file,
              name: file.name,
              folderName,
              status: 'pending'
            }]);
          } else {
            resolve([]);
          }
        });
      });
    } else if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const reader = dirEntry.createReader();
      return new Promise((resolve) => {
        reader.readEntries(async (entries) => {
          const results = await Promise.all(
            entries.map((e) => processFileEntry(e, `${path}${entry.name}/`))
          );
          resolve(results.flat());
        });
      });
    }
    return [];
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const items = e.dataTransfer.items;
    if (!items) return;

    const entryPromises: Promise<ProcessingFile[]>[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry();
      if (entry) {
        entryPromises.push(processFileEntry(entry));
      }
    }

    const newFiles = (await Promise.all(entryPromises)).flat();
    setFiles(prev => [...prev, ...newFiles]);
  }, []);

  const addFilesFromInput = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    
    const newFiles: ProcessingFile[] = Array.from(fileList)
      .filter(file => file.type === 'audio/mpeg' || file.name.endsWith('.mp3'))
      .map(file => {
        let folderName: string | undefined = undefined;
        if ((file as any).webkitRelativePath) {
          const pathParts = (file as any).webkitRelativePath.split('/');
          if (pathParts.length > 1) {
            folderName = pathParts[pathParts.length - 2];
          }
        }

        return {
          id: Math.random().toString(36).substr(2, 9),
          file,
          name: file.name,
          folderName,
          status: 'pending'
        };
      });

    setFiles(prev => [...prev, ...newFiles]);
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const startProcessing = async () => {
    setStatus(AppStatus.PROCESSING);
    
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.status !== 'pending') continue;

      setFiles(prev => prev.map(item => 
        item.id === f.id ? { ...item, status: 'processing' } : item
      ));

      try {
        const metadata = await parseMetadata(f.file, f.folderName);
        const fixedBlob = await fixFileTags(f.file, metadata);
        
        setFiles(prev => prev.map(item => 
          item.id === f.id ? { 
            ...item, 
            status: 'completed', 
            metadata, 
            fixedBlob 
          } : item
        ));
      } catch (err) {
        setFiles(prev => prev.map(item => 
          item.id === f.id ? { 
            ...item, 
            status: 'error', 
            error: '処理に失敗しました' 
          } : item
        ));
      }
    }
    
    setStatus(AppStatus.COMPLETED);
  };

  const downloadAsZip = async () => {
    const completedFiles = files.filter(f => f.status === 'completed' && f.fixedBlob);
    if (completedFiles.length === 0) return;

    setIsZipping(true);
    try {
      const zip = new JSZip();
      completedFiles.forEach(f => {
        zip.file(f.name, f.fixedBlob!);
      });

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = completedFiles.length === 1 
        ? `${completedFiles[0].name.replace(/\.mp3$/i, '')}.zip` 
        : "music_collection.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("ZIP creation failed", err);
      alert("ZIPファイルの作成に失敗しました。");
    } finally {
      setIsZipping(false);
    }
  };

  const clearFiles = () => {
    setFiles([]);
    setStatus(AppStatus.IDLE);
    setIsZipping(false);
  };

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-5xl mx-auto">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-slate-800 mb-2">🚗 Car Audio Tag Fixer</h1>
        <p className="text-slate-600">Windowsで取り込んだMP3の文字化けを直し、カーオーディオで正しく表示されるように変換します。</p>
      </header>

      <main className="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
        <div 
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`p-10 border-b border-slate-100 transition-all duration-300 relative ${
            isDragging ? 'bg-blue-50 border-blue-400' : 'bg-slate-50/50 border-transparent'
          }`}
        >
          {isDragging && (
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
              <div className="bg-white/80 px-8 py-4 rounded-full shadow-lg border border-blue-200 animate-bounce">
                <span className="text-blue-600 font-bold text-lg">ここにドロップして追加</span>
              </div>
            </div>
          )}
          
          <div className="flex flex-col items-center justify-center space-y-6">
            <div className="flex flex-col items-center text-center">
              <div className={`p-4 rounded-full mb-4 transition-transform duration-300 ${isDragging ? 'scale-125' : ''}`}>
                <MusicIcon />
              </div>
              <h2 className="text-xl font-semibold text-slate-700">ファイルまたはフォルダをドロップ</h2>
              <p className="text-slate-400 text-sm mt-1">または、下のボタンから選択してください</p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-white border border-slate-200 rounded-xl hover:border-blue-500 hover:text-blue-600 hover:shadow-sm transition-all text-slate-600 font-medium"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                ファイルを選択
              </button>
              
              <button
                onClick={() => folderInputRef.current?.click()}
                className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-white border border-slate-200 rounded-xl hover:border-emerald-500 hover:text-emerald-600 hover:shadow-sm transition-all text-slate-600 font-medium"
              >
                <FolderIcon />
                フォルダを選択
              </button>
            </div>
          </div>
          
          <input type="file" ref={fileInputRef} onChange={(e) => addFilesFromInput(e.target.files)} multiple accept=".mp3" className="hidden" />
          <input type="file" ref={folderInputRef} onChange={(e) => addFilesFromInput(e.target.files)} {...({ webkitdirectory: "", directory: "" } as any)} className="hidden" />
        </div>

        {files.length > 0 && (
          <div className="px-6 py-4 bg-white border-b border-slate-100 flex flex-wrap justify-between items-center gap-4">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-slate-600 bg-slate-100 px-3 py-1 rounded-full">
                {files.length} 個のファイル
              </span>
              <button onClick={clearFiles} className="text-sm text-red-500 hover:text-red-700 font-medium">リストをクリア</button>
            </div>
            
            <div className="flex gap-2">
              {status !== AppStatus.COMPLETED ? (
                <button
                  onClick={startProcessing}
                  disabled={status === AppStatus.PROCESSING}
                  className={`px-8 py-2.5 rounded-xl font-bold text-white transition-all ${
                    status === AppStatus.PROCESSING ? 'bg-slate-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-100'
                  }`}
                >
                  {status === AppStatus.PROCESSING ? '処理中...' : '変換を開始する'}
                </button>
              ) : (
                <button
                  onClick={downloadAsZip}
                  disabled={isZipping}
                  className={`flex items-center px-8 py-2.5 rounded-xl font-bold text-white transition-all shadow-lg shadow-emerald-100 ${
                    isZipping ? 'bg-slate-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  <ZipIcon />
                  {isZipping ? 'ZIP作成中...' : 'ZIP形式でダウンロード'}
                </button>
              )}
            </div>
          </div>
        )}

        <div className="max-h-[50vh] overflow-y-auto">
          {files.length === 0 ? (
            <div className="py-16 flex flex-col items-center text-slate-300">
              <svg className="w-16 h-16 opacity-20 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
              <p>ファイルが選択されていません</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                <tr>
                  <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">ファイル名 / フォルダ</th>
                  <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">状態</th>
                  <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">解析結果 (ID3v2.3)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {files.map(f => (
                  <tr key={f.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-slate-800 truncate max-w-xs">{f.name}</div>
                      {f.folderName && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <svg className="w-3 h-3 text-slate-300" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" /></svg>
                          <span className="text-[10px] text-slate-400 font-medium uppercase tracking-tighter">{f.folderName}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {f.status === 'pending' && <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-md">待機</span>}
                      {f.status === 'processing' && (
                        <div className="flex items-center gap-1.5">
                          <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                          <span className="text-[10px] text-blue-600 font-bold">処理中</span>
                        </div>
                      )}
                      {f.status === 'completed' && (
                        <div className="flex items-center gap-1">
                          <CheckCircleIcon />
                          <span className="text-[10px] text-green-600 font-bold">完了</span>
                        </div>
                      )}
                      {f.status === 'error' && <span className="text-[10px] font-bold bg-red-100 text-red-600 px-2 py-0.5 rounded-md">エラー</span>}
                    </td>
                    <td className="px-6 py-4">
                      {f.metadata ? (
                        <div className="text-[11px] leading-tight max-w-[200px]">
                          <div className="font-bold text-slate-700 truncate">{f.metadata.title}</div>
                          <div className="truncate text-blue-500">{f.metadata.album}</div>
                          <div className="truncate text-slate-400">{f.metadata.artist}</div>
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-300">--</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>

      <footer className="mt-12 text-center text-slate-400 text-sm">
        <div className="max-w-2xl mx-auto space-y-4">
          <div className="p-5 bg-blue-50/50 rounded-2xl border border-blue-100 text-slate-600 text-left">
            <h3 className="font-bold mb-2 flex items-center gap-2 text-blue-700">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              ヒント
            </h3>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-xs">
              <li className="flex gap-2">
                <span className="text-blue-500 font-bold">•</span>
                <span>エクスプローラーからフォルダごとドラッグ＆ドロップできます。</span>
              </li>
              <li className="flex gap-2">
                <span className="text-blue-500 font-bold">•</span>
                <span>ドロップした直上のフォルダ名を「アルバム名」として自動採用します。</span>
              </li>
              <li className="flex gap-2">
                <span className="text-blue-500 font-bold">•</span>
                <span>すべてのタグを ID3v2.3 / UTF-16 (BOMあり) に統一します。</span>
              </li>
              <li className="flex gap-2">
                <span className="text-blue-500 font-bold">•</span>
                <span>プライバシーに配慮し、すべての処理はブラウザ内で完結します。</span>
              </li>
            </ul>
          </div>
          <p>© 2024 Music Tag Fixer Utility - For Car Audio Compatibility</p>
        </div>
      </footer>
    </div>
  );
};

export default App;
