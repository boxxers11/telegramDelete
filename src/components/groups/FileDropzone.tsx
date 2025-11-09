import React, { useCallback, useRef, useState } from 'react';
import { UploadCloud, FileText } from 'lucide-react';

interface FileDropzoneProps {
  onFiles: (files: FileList) => void;
  accept?: string;
  multiple?: boolean;
  description?: string;
}

const FileDropzone: React.FC<FileDropzoneProps> = ({
  onFiles,
  accept = '.txt,.json,.csv,.xls,.xlsx,.pdf,.md,.doc,.docx',
  multiple = true,
  description = 'גרור לכאן או בחר קובץ ייבוא (txt/json/csv/xls/pdf/md)'
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (files && files.length > 0) {
        onFiles(files);
      }
    },
    [onFiles]
  );

  return (
    <div
      className={`rounded-3xl border-2 border-dashed p-6 text-center transition ${
        isDragging ? 'border-blue-400 bg-blue-500/10' : 'border-white/20 bg-white/5'
      }`}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        setIsDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        handleFiles(event.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={accept}
        multiple={multiple}
        onChange={(event) => handleFiles(event.target.files)}
      />
      <button
        type="button"
        className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-blue-500/10 text-blue-200"
        onClick={() => inputRef.current?.click()}
      >
        <UploadCloud className="h-6 w-6" />
      </button>
      <p className="text-sm text-white">{description}</p>
      <p className="mt-2 text-xs text-white/50">
        נתמכים: txt, csv, json, xls/xlsx, pdf, md, doc/docx. נחלץ אוטומטית קישורי קבוצות.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs text-white/60">
        <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1">
          <FileText className="h-3 w-3" />
          תמיכה בעברית ואנגלית
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1">
          <FileText className="h-3 w-3" />
          חילוץ אוטומטי של @username / t.me
        </span>
      </div>
    </div>
  );
};

export default FileDropzone;
