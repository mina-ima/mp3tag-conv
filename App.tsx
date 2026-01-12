
import React, { useState, useCallback, useRef } from 'react';
import { ProcessingFile, AppStatus } from './types.ts';
import { parseMetadata, fixFileTags, inferMetadataWithAI } from './services/id3Service.ts';
import JSZip from 'jszip';

// Standard icons
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

const SparklesIcon = () => (
  <svg className="w-4 h-4 text-amber-500 animate-pulse" fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.455a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z" clipRule="evenodd" />
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
  const [isInferring, setIsInferring] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const processFileEntry = async (entry: FileSystemEntry, path: string = ''): Promise<ProcessingFile[]> => {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      return new Promise((resolve) => {
        fileEntry.file((file) => {
          if (file.type === 'audio/mpeg' || file.name.endsWith('.mp3')) {
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
      if (entry) entryPromises.push(processFileEntry(entry));
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
          if (pathParts.length > 1) folderName = pathParts[pathParts.length - 2];
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

  const inferAllMetadata = async () => {
    setIsInferring(true);
    const updatedFiles = await Promise.all(files.map(async (f) => {
      const aiResult = await inferMetadataWithAI(f.name, f.folderName);
      return {
        ...f,
        metadata: {
          originalEncoding: 'UTF-8' as any,
          title: aiResult.title || f.name.replace(/\.[^/.]+$/, ""),
          artist: aiResult.artist || "不明",
          album: aiResult.album || f.folderName || "不明"
        }
      };
    }));
    setFiles(updatedFiles);
    setIsInferring(false);
  };

  const resetToFilename = (id: string) => {
    setFiles(prev => prev.map(f => {
      if (f.id === id) {
        return {
          ...f,
          metadata: {
            title: f.name.replace(/\.[^/.]+$/, ""),
            artist: "不明",
            album: f.folderName || "不明",
            originalEncoding: 'UTF-8' as any
          }
        };
      }
      return f;
    }));
  };

  const startProcessing = async () => {
    setStatus(AppStatus.PROCESSING);
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setFiles(prev => prev.map(item => item.id === f.id ? { ...item, status: 'processing' } : item));
      try {
        // メタデータがまだない場合、ファイルから読み取る（この時にUTF-8優先ガードが働く）
        const metadata = f.metadata || await parseMetadata(f.file, f.folderName);
        const fixedBlob = await fixFileTags(f.file, metadata);
        setFiles(prev => prev.map(item => item.id === f.id ? { ...item, status: 'completed', metadata, fixedBlob } : item));
      } catch (err) {
        setFiles(prev => prev.map(item => item.id === f.id ? { ...item, status: 'error', error: '失敗' } : item));
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
      completedFiles.forEach(f => zip.file(f.name, f.fixedBlob!));
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = completedFiles.length === 1 ? `${completedFiles[0].name.replace(/\.mp3$/i, '')}.zip` : "music_collection.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setIsZipping(false);
    }
  };

  const clearFiles = () => {
    setFiles([]);
    setStatus(AppStatus.IDLE);
  };

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-5xl mx-auto">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-slate-800 mb-2">🚗 Car Audio Tag Fixer</h1>
        <p className="text-slate-600 font-medium">Windowsで正しく見えるファイル名を最優先して、タグを美しく修正します。</p>
      </header>

      <main className="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
        <div 
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`p-10 border-b border-slate-100 transition-all duration-300 relative ${isDragging ? 'bg-blue-50 border-blue-400' : 'bg-slate-50/50'}`}
        >
          <div className="flex flex-col items-center justify-center space-y-6">
            <div className="flex flex-col items-center text-center">
              <div className={`p-4 rounded-full mb-4 transition-transform duration-300 ${isDragging ? 'scale-125' : ''}`}><MusicIcon /></div>
              <h2 className="text-xl font-semibold text-slate-700">ファイルまたはフォルダをドロップ</h2>
              <p className="text-slate-400 text-sm mt-1">Windowsで正しく見えているファイルをそのまま追加してください</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md">
              <button onClick={() => fileInputRef.current?.click()} className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-white border border-slate-200 rounded-xl hover:border-blue-500 hover:text-blue-600 transition-all font-medium text-slate-600">ファイルを選択</button>
              <button onClick={() => folderInputRef.current?.click()} className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-white border border-slate-200 rounded-xl hover:border-emerald-500 hover:text-emerald-600 transition-all font-medium text-slate-600">フォルダを選択</button>
            </div>
          </div>
          <input type="file" ref={fileInputRef} onChange={(e) => addFilesFromInput(e.target.files)} multiple accept=".mp3" className="hidden" />
          <input type="file" ref={folderInputRef} onChange={(e) => addFilesFromInput(e.target.files)} {...({ webkitdirectory: "", directory: "" } as any)} className="hidden" />
        </div>

        {files.length > 0 && (
          <div className="px-6 py-4 bg-white border-b border-slate-100 flex flex-wrap justify-between items-center gap-4">
            <div className="flex items-center gap-4">
              <span className="text-sm font-bold bg-slate-100 px-3 py-1 rounded-full text-slate-600">{files.length} 曲</span>
              <button onClick={inferAllMetadata} disabled={isInferring || status === AppStatus.PROCESSING} className="flex items-center gap-1.5 text-sm font-bold text-amber-600 hover:text-amber-700 disabled:opacity-50">
                <SparklesIcon />
                {isInferring ? 'ファイル名からAI解析中...' : 'ファイル名を元にAIで整理'}
              </button>
              <button onClick={clearFiles} className="text-xs text-red-400 hover:text-red-600 ml-2">すべてクリア</button>
            </div>
            
            <div className="flex gap-2">
              {status !== AppStatus.COMPLETED ? (
                <button onClick={startProcessing} disabled={status === AppStatus.PROCESSING || isInferring} className="px-8 py-2.5 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-100 disabled:bg-slate-300">
                  {status === AppStatus.PROCESSING ? '変換中...' : '変換を開始する'}
                </button>
              ) : (
                <button onClick={downloadAsZip} disabled={isZipping} className="flex items-center px-8 py-2.5 rounded-xl font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-100 disabled:bg-slate-300">
                  <ZipIcon />
                  {isZipping ? 'ZIP作成中...' : 'ZIPを保存'}
                </button>
              )}
            </div>
          </div>
        )}

        <div className="max-h-[50vh] overflow-y-auto">
          {files.length > 0 && (
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                <tr>
                  <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">元ファイル</th>
                  <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">書き込み予定のタグ</th>
                  <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap text-center">操作</th>
                  <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">状態</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {files.map(f => (
                  <tr key={f.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-slate-800 truncate max-w-[180px]" title={f.name}>{f.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono truncate max-w-[180px]">{f.folderName || 'Root'}</div>
                    </td>
                    <td className="px-6 py-4">
                      {f.metadata ? (
                        <div className="text-[11px] leading-tight max-w-[250px]">
                          <div className="font-bold text-slate-700">{f.metadata.title}</div>
                          <div className="text-blue-500 mt-0.5">{f.metadata.artist}</div>
                          <div className="text-slate-400 italic">{f.metadata.album}</div>
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-300 italic">自動解析待ち...</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button 
                        onClick={() => resetToFilename(f.id)}
                        title="既存タグを無視してファイル名を採用"
                        className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-1 rounded transition-colors whitespace-nowrap"
                      >
                        ファイル名優先
                      </button>
                    </td>
                    <td className="px-6 py-4">
                      {f.status === 'processing' ? (
                        <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                      ) : f.status === 'completed' ? (
                        <CheckCircleIcon />
                      ) : f.status === 'error' ? (
                        <span className="text-[10px] text-red-500 font-bold">ERR</span>
                      ) : (
                        <span className="text-[10px] text-slate-400 font-bold">待機</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>

      <footer className="mt-12 text-center text-slate-400 text-sm max-w-3xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <div className="p-5 bg-blue-50 rounded-2xl border border-blue-100 text-slate-700 text-left">
            <h3 className="font-bold mb-2 text-blue-700 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              文字化け防止の仕組み
            </h3>
            <p className="text-[11px] leading-relaxed">
              既存のタグがUTF-8かShift-JISかを自動判定し、不適切な変換を防止します。Windowsで正しく見える情報は「ファイル名」に集約されていることが多いため、AIボタンを使うとファイル名を解析してタグを再構築します。
            </p>
          </div>
          <div className="p-5 bg-amber-50 rounded-2xl border border-amber-100 text-slate-700 text-left">
            <h3 className="font-bold mb-2 text-amber-700 flex items-center gap-2">
              <SparklesIcon />
              ファイル名優先ボタン
            </h3>
            <p className="text-[11px] leading-relaxed">
              もし解析結果が文字化けしている場合は、表の中の「ファイル名優先」ボタンを押してください。内部の壊れたタグを無視し、エクスプローラーで見えている正しい名称をタグとして採用します。
            </p>
          </div>
        </div>
        <p>© 2024 Music Tag Fixer Utility</p>
      </footer>
    </div>
  );
};

export default App;
