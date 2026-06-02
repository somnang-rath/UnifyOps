'use client';
import { useState, useEffect } from 'react';
import type {
  ReportTemplate,
  ReportSchedule,
  ReportRecipient,
  ReportPermissions,
  ReportDataRecipientsConfig,
  ReportPerRecipientUrlConfig,
} from '@/schemas/report';
import { useReportMutations } from '@/hooks/use-reports';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SchedulePanel } from './schedule-panel';
import { RecipientsPanel } from './recipients-panel';
import { toast } from '@/stores/toast-store';
import { CheckCircle2, Loader2, Mail, SendHorizonal, Zap } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  template: ReportTemplate;
}

export function QuickScheduleModal({ open, onClose, template }: Props) {
  const { update, sendTest, sendToRecipients } = useReportMutations();

  const [schedule, setSchedule]       = useState<ReportSchedule>(template.schedule);
  const [recipients, setRecipients]   = useState<ReportRecipient[]>(template.recipients ?? []);
  const [permissions, setPermissions] = useState<ReportPermissions>(
    template.permissions ?? { allowDownload: true, allowedFormats: ['pdf'] },
  );
  const [dataRecipientsConfig, setDataRecipientsConfig] = useState<ReportDataRecipientsConfig>(
    template.dataRecipientsConfig ?? { enabled: false, emailField: '', nameField: '', dataPath: '', url: '' },
  );
  const [perRecipientUrlConfig, setPerRecipientUrlConfig] = useState<ReportPerRecipientUrlConfig>(
    template.perRecipientUrlConfig ?? { enabled: false, listUrl: '', listDataPath: '', idField: 'id', emailField: 'email', nameField: '', dataUrlTemplate: '' },
  );
  const [testResult, setTestResult] = useState<{ sent: number } | null>(null);

  // Sync from template only when the modal transitions from closed → open.
  useEffect(() => {
    if (!open) return;
    setSchedule(template.schedule);
    setRecipients(template.recipients ?? []);
    setPermissions(template.permissions ?? { allowDownload: true, allowedFormats: ['pdf'] });
    setDataRecipientsConfig(
      template.dataRecipientsConfig ?? { enabled: false, emailField: '', nameField: '', dataPath: '', url: '' },
    );
    setPerRecipientUrlConfig(
      template.perRecipientUrlConfig ?? { enabled: false, listUrl: '', listDataPath: '', idField: 'id', emailField: 'email', nameField: '', dataUrlTemplate: '' },
    );
    setTestResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const hasUnsavedRecipients =
    JSON.stringify(recipients) !== JSON.stringify(template.recipients ?? []);

  const handleSave = async () => {
    await update.mutateAsync({
      id: template._id,
      body: { schedule, recipients, permissions, dataRecipientsConfig, perRecipientUrlConfig },
    });
    toast(schedule.enabled ? 'Auto-send schedule saved' : 'Schedule disabled');
    onClose();
  };

  const handleSendTest = async () => {
    if (hasUnsavedRecipients || recipients.length !== (template.recipients?.length ?? 0)) {
      await update.mutateAsync({
        id: template._id,
        body: { schedule, recipients, permissions, dataRecipientsConfig, perRecipientUrlConfig },
      });
    }
    const result = await sendTest.mutateAsync(template._id);
    setTestResult(result);
    toast(`Test email sent to ${result.sent} recipient${result.sent !== 1 ? 's' : ''}`);
  };

  const handleSendNow = async () => {
    await update.mutateAsync({
      id: template._id,
      body: { schedule, recipients, permissions, dataRecipientsConfig, perRecipientUrlConfig },
    });
    sendToRecipients.mutate(template._id);
    onClose();
  };

  const cpoMode       = perRecipientUrlConfig.enabled && !!perRecipientUrlConfig.listUrl;
  const autoMode      = !cpoMode && dataRecipientsConfig.enabled && !!dataRecipientsConfig.emailField;
  const recipientCount = (autoMode || cpoMode) ? null : recipients.length;
  const isBusy        = update.isPending || sendTest.isPending || sendToRecipients.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-accent-600" />
          <span>Email Schedule — {template.name}</span>
        </div>
      }
      footer={
        <div className="flex items-center gap-2 w-full flex-wrap">
          {/* Send Now (async) — left side */}
          <Button
            variant="primary"
            size="sm"
            onClick={handleSendNow}
            disabled={isBusy || (!autoMode && recipientCount === 0)}
            title={
              !autoMode && !cpoMode && recipientCount === 0
                ? 'Add recipients first'
                : cpoMode
                  ? 'Fetch CPO list and send each a personalised PDF'
                  : autoMode
                    ? 'Send to all recipients extracted from API data'
                    : `Send to ${recipientCount} recipient(s) now`
            }
            className={cn(
              'gap-1.5 mr-auto',
            )}
          >
            {sendToRecipients.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : cpoMode || autoMode ? (
              <Zap className="w-3.5 h-3.5" />
            ) : (
              <SendHorizonal className="w-3.5 h-3.5" />
            )}
            {cpoMode ? 'Send Now (per CPO)' : autoMode ? 'Send Now (auto)' : 'Send Now'}
          </Button>

          {/* Test send (only in manual mode) */}
          {!autoMode && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSendTest}
              disabled={isBusy || recipientCount === 0}
              title={recipientCount === 0 ? 'Add recipients first' : 'Send a test PDF now'}
              className={cn(
                'gap-1.5',
                testResult && 'border-green-400 text-green-600 dark:border-green-600 dark:text-green-400',
              )}
            >
              {sendTest.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : testResult ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : (
                <SendHorizonal className="w-3.5 h-3.5" />
              )}
              {testResult ? `Sent to ${testResult.sent}` : 'Test'}
            </Button>
          )}

          <Button variant="outline" size="sm" onClick={onClose} disabled={isBusy}>
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSave}
            disabled={isBusy}
            className="gap-1.5"
          >
            {update.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-5 py-1">
        <SchedulePanel schedule={schedule} onChange={setSchedule} />
        <div className="border-t border-border" />
        <RecipientsPanel
          recipients={recipients}
          permissions={permissions}
          dataRecipientsConfig={dataRecipientsConfig}
          perRecipientUrlConfig={perRecipientUrlConfig}
          blocklist={template.blocklist}
          templateId={template._id}
          onChangeRecipients={setRecipients}
          onChangePermissions={setPermissions}
          onChangeDataRecipientsConfig={setDataRecipientsConfig}
          onChangePerRecipientUrlConfig={setPerRecipientUrlConfig}
        />
      </div>
    </Modal>
  );
}
