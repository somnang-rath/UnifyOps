'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal, Button, Input, Field, Switch } from '@prism/ui';
import { useCreateChannel } from '@/hooks/use-chat';

export function NewChannelModal({
  workspaceId,
  workspaceSlug,
  onClose,
}: {
  workspaceId: string;
  workspaceSlug: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const create = useCreateChannel(workspaceId);
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(
      {
        name: trimmed,
        topic: topic.trim(),
        visibility: isPrivate ? 'private' : 'public',
      },
      {
        onSuccess: (ch) => {
          onClose();
          router.push(`/${workspaceSlug}/chat/${ch._id}`);
        },
      },
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="New channel"
      description="Channels are where your team talks about a topic."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim() || create.isPending}>
            Create
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="e.g. marketing"
          />
        </Field>
        <Field label="Topic (optional)">
          <Input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="What's this channel about?"
          />
        </Field>
        <label className="flex items-center justify-between py-1">
          <div>
            <div className="text-[13px] font-medium">Private</div>
            <div className="text-[12px] text-text-muted">
              Only invited members can see this channel.
            </div>
          </div>
          <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
        </label>
      </div>
    </Modal>
  );
}
