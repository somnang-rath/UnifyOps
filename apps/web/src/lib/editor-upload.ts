import { api } from '@/lib/api';
import { toast } from '@/stores/toast-store';
import type { UploadedAttachment } from '@prism/editor';

/** Matches the API's MAX_UPLOAD (files.controller). */
export const ATTACH_MAX_BYTES = 25 * 1024 * 1024;

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';

/**
 * Upload one editor attachment and return where it now lives — the shared
 * `onUpload` handler for both the wiki RichTextEditor and the notes
 * CollabToolbar (spec §5.8). App-specific (touches `api`), so it lives in web,
 * not in @prism/editor.
 */
export async function uploadEditorFile(
  file: File,
): Promise<UploadedAttachment | null> {
  if (file.size > ATTACH_MAX_BYTES) {
    toast(
      `"${file.name}" is too large (max ${ATTACH_MAX_BYTES / 1024 / 1024}MB)`,
      'error',
    );
    return null;
  }
  try {
    const fd = new FormData();
    fd.append('file', file);
    const { data } = await api.post<{
      _id: string;
      name: string;
      mimeType: string;
    }>('/files/comment-upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return {
      url: `${apiBase}/files/public/${data._id}`,
      name: data.name,
      isImage: (data.mimeType ?? file.type).startsWith('image/'),
    };
  } catch {
    return null; // api.ts toasts on 4xx/5xx
  }
}
