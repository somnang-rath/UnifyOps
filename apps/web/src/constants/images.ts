const Images = {
  pdf: '/imgs/files_name/PDF.png',
  docx: '/imgs/files_name/DOCX.png',
  xlsx: '/imgs/files_name/XLSX.png',
  txt: '/imgs/files_name/TXT.png',
  exe: '/imgs/files_name/EXE.png',
} as const;

export type ImageKey = keyof typeof Images;

const EXT_TO_ICON: Record<string, ImageKey> = {
  pdf: 'pdf',
  doc: 'docx',
  docx: 'docx',
  xls: 'xlsx',
  xlsx: 'xlsx',
  csv: 'xlsx',
  txt: 'txt',
  log: 'txt',
  md: 'txt',
  exe: 'exe',
  msi: 'exe',
};

export function fileIconFor(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext) return null;
  const key = EXT_TO_ICON[ext];
  return key ? Images[key] : null;
}

export default Images;
