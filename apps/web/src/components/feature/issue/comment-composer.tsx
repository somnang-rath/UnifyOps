'use client';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { toast } from '@/stores/toast-store';
import {
  RichTextEditor,
  type UploadedAttachment,
} from '@prism/editor';

const ATTACH_MAX_BYTES = 25 * 1024 * 1024; // matches API MAX_UPLOAD

export interface MentionUser {
  name: string;
  email: string;
}

interface Props {
  authorName: string;
  authorAvatar?: string | null;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  submitting?: boolean;
  placeholder?: string;
  users?: MentionUser[];
}

export function CommentComposer({
  authorName,
  authorAvatar,
  value,
  onChange,
  onSubmit,
  placeholder = 'Write a comment, @mention teammates, or drop files here…',
  users = [],
}: Props) {
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';

  // Upload a single file to the API and tell the editor where it landed.
  const handleUpload = async (
    file: File,
  ): Promise<UploadedAttachment | null> => {
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
      // api.ts already toasts on 4xx/5xx
      return null;
    }
  };

  return (
    <div className="flex gap-2.5 items-start">
      <Avatar name={authorName} src={authorAvatar} size="sm" />
      <div className="flex-1 min-w-0">
        <RichTextEditor
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={placeholder}
          users={users}
          onUpload={handleUpload}
          minHeight={110}
        />
      </div>
    </div>
  );
}

// Render action row as a sibling so it sits flush-right under the composer.
export function CommentComposerActions({
  onCancel,
  onSubmit,
  submitting,
  disabled,
}: {
  onCancel?: () => void;
  onSubmit: () => void;
  submitting?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2 mt-2.5">
      {onCancel && (
        <Button variant="outline" size="md" onClick={onCancel} type="button">
          Cancel
        </Button>
      )}
      <Button
        variant="primary"
        size="md"
        type="button"
        onClick={onSubmit}
        disabled={disabled || submitting}
      >
        Comment
      </Button>
    </div>
  );
}
