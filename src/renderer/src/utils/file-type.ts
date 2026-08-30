// File type utilities — maps file extensions to icons and labels.
// Used by FilePreviewPanel to display appropriate file type indicators.

import type { Component } from 'vue'
import {
  PictureAsPdfOutlined,
  DescriptionOutlined,
  TableChartOutlined,
  SlideshowOutlined,
  ImageOutlined,
  CodeOutlined,
  InsertDriveFileOutlined,
} from '@vicons/material'

/** Extension → icon component map */
const FILE_TYPE_ICON_MAP: Record<string, Component> = {
  // PDF
  pdf: PictureAsPdfOutlined,
  ofd: PictureAsPdfOutlined,
  // Word
  doc: DescriptionOutlined,
  docx: DescriptionOutlined,
  rtf: DescriptionOutlined,
  odt: DescriptionOutlined,
  // Excel
  xls: TableChartOutlined,
  xlsx: TableChartOutlined,
  csv: TableChartOutlined,
  ods: TableChartOutlined,
  // PowerPoint
  ppt: SlideshowOutlined,
  pptx: SlideshowOutlined,
  pps: SlideshowOutlined,
  ppsx: SlideshowOutlined,
  odp: SlideshowOutlined,
  // Images
  png: ImageOutlined,
  jpg: ImageOutlined,
  jpeg: ImageOutlined,
  gif: ImageOutlined,
  svg: ImageOutlined,
  webp: ImageOutlined,
  bmp: ImageOutlined,
  ico: ImageOutlined,
  // Code
  js: CodeOutlined,
  jsx: CodeOutlined,
  ts: CodeOutlined,
  tsx: CodeOutlined,
  vue: CodeOutlined,
  py: CodeOutlined,
  java: CodeOutlined,
  go: CodeOutlined,
  rs: CodeOutlined,
  c: CodeOutlined,
  cpp: CodeOutlined,
  cs: CodeOutlined,
  rb: CodeOutlined,
  php: CodeOutlined,
  swift: CodeOutlined,
  kt: CodeOutlined,
  scala: CodeOutlined,
  sh: CodeOutlined,
  bash: CodeOutlined,
  zsh: CodeOutlined,
  sql: CodeOutlined,
  html: CodeOutlined,
  css: CodeOutlined,
  scss: CodeOutlined,
  json: CodeOutlined,
  yaml: CodeOutlined,
  yml: CodeOutlined,
  xml: CodeOutlined,
  toml: CodeOutlined,
}

/** Extension → label map */
const FILE_TYPE_LABEL_MAP: Record<string, string> = {
  pdf: 'PDF',
  ofd: 'OFD',
  doc: 'DOC',
  docx: 'DOCX',
  rtf: 'RTF',
  odt: 'ODT',
  xls: 'XLS',
  xlsx: 'XLSX',
  csv: 'CSV',
  ods: 'ODS',
  ppt: 'PPT',
  pptx: 'PPTX',
  pps: 'PPS',
  ppsx: 'PPSX',
  odp: 'ODP',
  png: 'IMG',
  jpg: 'IMG',
  jpeg: 'IMG',
  gif: 'IMG',
  svg: 'SVG',
  webp: 'IMG',
  bmp: 'IMG',
  ico: 'IMG',
  js: 'JS',
  jsx: 'JSX',
  ts: 'TS',
  tsx: 'TSX',
  vue: 'VUE',
  py: 'PY',
  java: 'JAVA',
  go: 'GO',
  rs: 'RUST',
  c: 'C',
  cpp: 'CPP',
  cs: 'C#',
  rb: 'RB',
  php: 'PHP',
  swift: 'SWIFT',
  kt: 'KT',
  scala: 'SCALA',
  sh: 'SH',
  bash: 'SH',
  zsh: 'SH',
  sql: 'SQL',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  xml: 'XML',
  toml: 'TOML',
  md: 'MD',
  markdown: 'MD',
  txt: 'TXT',
  log: 'LOG',
  env: 'ENV',
  ini: 'INI',
  cfg: 'CFG',
  conf: 'CONF',
}

/** Default icon for unknown file types */
const DEFAULT_ICON = InsertDriveFileOutlined

/**
 * Get the icon component for a given filename.
 * Falls back to a generic file icon for unknown extensions.
 */
export function getFileTypeIcon(filename: string): Component {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return FILE_TYPE_ICON_MAP[ext] ?? DEFAULT_ICON
}

/**
 * Get a short label for a given filename's type.
 * Falls back to the uppercase extension, or 'FILE' if no extension.
 */
export function getFileTypeLabel(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return FILE_TYPE_LABEL_MAP[ext] ?? (ext ? ext.toUpperCase() : 'FILE')
}
