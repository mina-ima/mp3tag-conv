
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
  <svg className="w-12 h-12 text-blue-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
  </svg>
);

const CheckCircleIcon = () => (
  <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    
    const newFiles: ProcessingFile[] = Array.from(fileList)
      .filter(file => file.type === 'audio/mpeg' || file.name.endsWith('.mp3'))
      .map(file => {
        // Extract folder name from path if available (webkitRelativePath)
        let folderName: string | undefined = undefined;
        if ((file as any).webkitRelativePath) {
          const pathParts = (file as any).webkitRelativePath.split('/');
          if (pathParts.length > 1) {
            // Get the immediate parent folder of the file
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(e.target.files);
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
        // Pass folderName to parseMetadata so it can be used as Album name
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
        // Use the original name directly without 'fixed_' prefix
        const fileName = f.name;
        zip.file(fileName, f.fixedBlob!);
      });

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      
      // Also cleanup the ZIP filename itself
      if (completedFiles.length === 1) {
        a.download = `${completedFiles[0].name.replace(/\.mp3$/i, '')}.zip`;
      } else {
        a.download = "music_collection.zip";
      }

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
        <div className="p-8 border-b border-slate-100 bg-slate-50/50">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-center">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center px-6 py-3 bg-white border-2 border-dashed border-blue-300 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-all group w-full md:w-auto justify-center"
            >
              <MusicIcon />
              <span className="ml-3 font-medium text-slate-700">ファイルを選択</span>
            </button>
            
            <button
              onClick={() => folderInputRef.current?.click()}
              className="flex items-center px-6 py-3 bg-white border-2 border-dashed border-emerald-300 rounded-xl hover:border-emerald-500 hover:bg-emerald-50 transition-all group w-full md:w-auto justify-center"
            >
              <FolderIcon />
              <span className="ml-3 font-medium text-slate-700">フォルダを選択</span>
            </button>
            
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              multiple
              accept=".mp3"
              className="hidden"
            />
            
            <input
              type="file"
              ref={folderInputRef}
              onChange={handleFileChange}
              {...({ webkitdirectory: "", directory: "" } as any)}
              className="hidden"
            />
          </div>
          
          <p className="mt-4 text-center text-sm text-slate-500">
            Shift-JISで書かれたID3タグを、カーオーディオが認識しやすいUTF-16(BOM付き)に自動変換します。
          </p>
        </div>

        {files.length > 0 && (
          <div className="px-6 py-4 bg-white border-b border-slate-100 flex flex-wrap justify-between items-center gap-4">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-slate-600">
                {files.length} 個のファイル
              </span>
              <button 
                onClick={clearFiles}
                className="text-sm text-red-500 hover:text-red-700 font-medium"
              >
                リストをクリア
              </button>
            </div>
            
            <div className="flex gap-2">
              {status !== AppStatus.COMPLETED ? (
                <button
                  onClick={startProcessing}
                  disabled={status === AppStatus.PROCESSING}
                  className={`px-6 py-2 rounded-lg font-semibold text-white transition-all ${
                    status === AppStatus.PROCESSING 
                      ? 'bg-slate-400 cursor-not-allowed' 
                      : 'bg-blue-600 hover:bg-blue-700 shadow-md'
                  }`}
                >
                  {status === AppStatus.PROCESSING ? '処理中...' : '変換を開始する'}
                </button>
              ) : (
                <button
                  onClick={downloadAsZip}
                  disabled={isZipping}
                  className={`flex items-center px-6 py-2 rounded-lg font-semibold text-white transition-all shadow-md ${
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

        <div className="max-h-[60vh] overflow-y-auto">
          {files.length === 0 ? (
            <div className="py-20 flex flex-col items-center text-slate-400">
              <div className="mb-4">
                <MusicIcon />
              </div>
              <p>ここにMP3ファイルをドラッグ＆ドロップ、または上のボタンから選択してください。</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                <tr>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">ファイル名</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">ステータス</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">推定メタデータ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {files.map(f => (
                  <tr key={f.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        <span className="text-sm font-medium text-slate-800 truncate max-w-xs">{f.name}</span>
                      </div>
                      {f.folderName && <div className="text-[10px] text-slate-400">フォルダ: {f.folderName}</div>}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {f.status === 'pending' && <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full">待機中</span>}
                        {f.status === 'processing' && (
                          <div className="flex items-center gap-2">
                            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                            <span className="text-xs text-blue-600 font-medium">変換中</span>
                          </div>
                        )}
                        {f.status === 'completed' && (
                          <div className="flex items-center gap-1">
                            <CheckCircleIcon />
                            <span className="text-xs text-green-600 font-medium">完了</span>
                          </div>
                        )}
                        {f.status === 'error' && <span className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded-full">{f.error}</span>}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {f.metadata ? (
                        <div className="text-xs text-slate-500 leading-tight">
                          <p className="font-semibold text-slate-700 truncate">{f.metadata.title}</p>
                          <p className="truncate text-blue-600">{f.metadata.album}</p>
                          <p className="truncate">{f.metadata.artist}</p>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-300">--</span>
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
          <div className="p-4 bg-amber-50 rounded-lg border border-amber-100 text-amber-800 text-left">
            <h3 className="font-bold mb-1 flex items-center gap-2">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" /></svg>
              使い方のアドバイス
            </h3>
            <ul className="list-disc list-inside space-y-1">
              <li>Windows Media Player等で取り込んだ曲が「」のように化ける現象を解決します。</li>
              <li>変換後のファイルは、ID3v2.3形式・UTF-16エンコーディングとして保存されます。</li>
              <li>フォルダー単位でアップロードした場合、そのフォルダー名をアルバム名として自動設定します。</li>
              <li>変換されたファイルは、ZIP圧縮された状態でダウンロードされます。</li>
            </ul>
          </div>
          <p>© 2024 Music Tag Fixer Utility - ブラウザ内ですべての処理を行うため、ファイルがサーバーに送信されることはありません。</p>
        </div>
      </footer>
    </div>
  );
};

export default App;
