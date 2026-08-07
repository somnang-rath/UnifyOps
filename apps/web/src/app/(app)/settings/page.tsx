'use client';
import { forwardRef, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  AlertTriangle,
  Bell,
  Check,
  Copy,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Pencil,
  Shield,
  Sun,
  Trash2,
  Upload,
  User as UserIcon,
} from 'lucide-react';
import {
  LOCALES,
  persistLocale,
  useLocale,
  useT,
  type Locale,
} from '@prism/i18n';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { ImageCropModal } from '@/components/feature/sheets/image-crop-modal';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';
import {
  useThemeStore,
  type Accent,
  type Density,
  type Theme,
} from '@/stores/theme-store';
import { useUpdateProfile } from '@/hooks/use-users';
import {
  NOTIF_PREF_TYPES,
  useNotifPrefs,
  useUpdateNotifPrefs,
} from '@/hooks/use-notif-prefs';
import {
  useApiTokens,
  useChangePassword,
  useClearData,
  useConfirm2FA,
  useCreateApiToken,
  useDisable2FA,
  useRevokeApiToken,
  useSetup2FA,
} from '@/hooks/use-security';
import { BackupExportCard }   from '@/components/feature/backup/backup-export-card';
import { BackupScheduleCard } from '@/components/feature/backup/backup-schedule-card';
import { BackupImportCard }   from '@/components/feature/backup/backup-import-card';
import { BackupHistoryCard }  from '@/components/feature/backup/backup-history-card';
import { TelegramIdentityCard } from '@/components/feature/chat/telegram-identity-card';
import { useLogout } from '@/lib/auth';
import {
  isSoundEnabled,
  playPing,
  setSoundEnabled,
} from '@/lib/notification-sound';
import { cn } from '@/lib/utils';
import { useFormat } from '@prism/i18n';
import type { NotifType } from '@/schemas/notification';

type Pane = 'profile' | 'appearance' | 'notifications' | 'security' | 'data';

const ACCENTS: { id: Accent; hex: string }[] = [
  { id: 'indigo', hex: '#6366f1' },
  { id: 'violet', hex: '#8b5cf6' },
  { id: 'pink', hex: '#ec4899' },
  { id: 'rose', hex: '#f43f5e' },
  { id: 'amber', hex: '#f59e0b' },
  { id: 'emerald', hex: '#10b981' },
  { id: 'cyan', hex: '#06b6d4' },
  { id: 'blue', hex: '#3b82f6' },
];

const ProfileForm = z.object({
  name: z.string().min(1, 'Name is required').max(60),
  email: z.string().email(),
  gender: z.enum(['', 'male', 'female', 'other']),
  dateOfBirth: z.string(),
  nationality: z.string().max(60),
  jobTitle: z.string().max(80),
  department: z.string().max(80),
  employmentType: z.enum(['', 'full-time', 'part-time', 'contract']),
});
type ProfileInput = z.infer<typeof ProfileForm>;

const GENDER_OPTS = [
  { value: '', label: 'Not specified' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
] as const;

const EMPLOYMENT_OPTS = [
  { value: '', label: 'Not specified' },
  { value: 'full-time', label: 'Full-time' },
  { value: 'part-time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
] as const;

const MAX_PHOTO_BYTES = 1_500_000;

export default function SettingsPage() {
  const me = useAuthStore((s) => s.user)!;
  const t = useT();
  const locale = useLocale();
  const { theme, accent, density, setTheme, setAccent, setDensity } =
    useThemeStore();
  const updateProfile = useUpdateProfile();
  const logout = useLogout();

  const [pane, setPane] = useState<Pane>('profile');
  const [editing, setEditing] = useState(false);

  const profileDefaults = (): ProfileInput => ({
    name: me.name,
    email: me.email,
    gender: (me.gender ?? '') as ProfileInput['gender'],
    dateOfBirth: me.dateOfBirth ? me.dateOfBirth.slice(0, 10) : '',
    nationality: me.nationality ?? '',
    jobTitle: me.jobTitle ?? '',
    department: me.department ?? '',
    employmentType: (me.employmentType ?? '') as ProfileInput['employmentType'],
  });

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProfileInput>({
    resolver: zodResolver(ProfileForm),
    defaultValues: profileDefaults(),
  });

  const fileRef = useRef<HTMLInputElement>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);

  const onSaveProfile = handleSubmit(async (v) => {
    await updateProfile.mutateAsync({
      name: v.name,
      gender: v.gender === '' ? null : v.gender,
      dateOfBirth: v.dateOfBirth === '' ? null : v.dateOfBirth,
      nationality: v.nationality.trim() === '' ? null : v.nationality.trim(),
      jobTitle: v.jobTitle.trim() === '' ? null : v.jobTitle.trim(),
      department: v.department.trim() === '' ? null : v.department.trim(),
      employmentType: v.employmentType === '' ? null : v.employmentType,
    });
    setEditing(false);
  });

  const startEdit = () => {
    reset(profileDefaults());
    setEditing(true);
  };
  const cancelEdit = () => {
    reset(profileDefaults());
    setEditing(false);
  };

  const onPhotoPick = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('Please choose an image file', 'error');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      toast('Image is too large (max ~1.5 MB)', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (dataUrl) setCropSrc(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const onCropApply = (cropped: string) => {
    setCropSrc(null);
    updateProfile.mutate({ avatar: cropped });
  };

  const setAccentPersisted = (a: Accent) => {
    setAccent(a);
    updateProfile.mutate({ accent: a });
  };
  const setThemePersisted = (t: Theme) => {
    setTheme(t);
    updateProfile.mutate({ theme: t });
  };
  const setDensityPersisted = (d: Density) => {
    setDensity(d);
    updateProfile.mutate({ density: d });
  };
  /**
   * Two writes and a reload (ADR 0016 §2.1): the cookie is what the *next*
   * request resolves from, the user record is the cross-device default, and the
   * reload is not optional — every string on screen, `<html lang>`, and the RSC
   * payload itself were produced by the server in the old locale.
   *
   * Reload after the mutation settles rather than beside it; navigating away
   * mid-flight would cancel the request that makes the choice stick elsewhere.
   */
  const setLocalePersisted = (l: Locale) => {
    if (l === locale) return;
    persistLocale(l);
    updateProfile.mutate(
      { locale: l },
      { onSettled: () => window.location.reload() },
    );
  };

  return (
    <>
      {cropSrc && (
        <ImageCropModal
          src={cropSrc}
          squareLock
          onApply={onCropApply}
          onClose={() => setCropSrc(null)}
        />
      )}
      <div className="mb-5">
        <h1 className="text-[24px] font-bold tracking-[-.02em] leading-[1.2]">
          Settings
        </h1>
        <p className="text-[13px] text-text-muted mt-1">
          Personalize your workspace
        </p>
      </div>

      <div className="grid grid-cols-[220px_1fr] gap-6 items-start">
        <aside className="flex flex-col gap-[3px] bg-bg-card border border-border rounded-lg p-1.5 sticky top-[calc(var(--tb-h)+16px)]">
          <NavItem
            active={pane === 'profile'}
            onClick={() => setPane('profile')}
            Icon={UserIcon}
          >
            Profile
          </NavItem>
          <NavItem
            active={pane === 'appearance'}
            onClick={() => setPane('appearance')}
            Icon={Palette}
          >
            Appearance
          </NavItem>
          <NavItem
            active={pane === 'notifications'}
            onClick={() => setPane('notifications')}
            Icon={Bell}
          >
            Notifications
          </NavItem>
          <NavItem
            active={pane === 'security'}
            onClick={() => setPane('security')}
            Icon={Shield}
          >
            Security
          </NavItem>
          <NavItem
            active={pane === 'data'}
            onClick={() => setPane('data')}
            Icon={Database}
          >
            Data
          </NavItem>
          <NavItem onClick={logout} Icon={LogOut} danger>
            Sign out
          </NavItem>
        </aside>

        <main className="flex flex-col gap-4">
          {pane === 'profile' && (
            <>
            <Card
              title="Profile"
              sub="Your personal information and contact details"
              right={
                !editing && (
                  <Button
                    variant="primary"
                    type="button"
                    onClick={startEdit}
                  >
                    <Pencil className="w-3.5 h-3.5" /> Update
                  </Button>
                )
              }
            >
              {!editing ? (
                <div className="flex gap-6 items-start flex-wrap">
                  <div className="flex-shrink-0 w-[80px] h-[80px] rounded-full overflow-hidden border border-border bg-bg-subtle">
                    {me.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={me.avatar}
                        alt={me.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Avatar
                        name={me.name}
                        size="lg"
                        className="!w-[80px] !h-[80px] !text-[24px] !rounded-none"
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-[280px] grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3.5">
                    <InfoRow label="Name" value={me.name} />
                    <InfoRow label="Email" value={me.email} />
                    <InfoRow label="Role" value={me.role} />
                    <InfoRow
                      label="Gender"
                      value={
                        me.gender
                          ? me.gender[0].toUpperCase() + me.gender.slice(1)
                          : null
                      }
                    />
                    <InfoRow
                      label="Date of birth"
                      value={
                        me.dateOfBirth ? me.dateOfBirth.slice(0, 10) : null
                      }
                    />
                    <InfoRow label="Nationality" value={me.nationality} />
                    <InfoRow
                      label="Job title / Position"
                      value={me.jobTitle}
                    />
                    <InfoRow label="Department" value={me.department} />
                    <InfoRow
                      label="Employment type"
                      value={
                        me.employmentType
                          ? me.employmentType
                              .split('-')
                              .map(
                                (p) => p[0].toUpperCase() + p.slice(1),
                              )
                              .join('-')
                          : null
                      }
                    />
                  </div>
                </div>
              ) : (
                <form
                  onSubmit={onSaveProfile}
                  className="flex gap-6 items-start flex-wrap"
                >
                  <div className="flex-shrink-0 flex flex-col items-center gap-2">
                    <div className="relative w-[80px] h-[80px] rounded-full overflow-hidden border border-border bg-bg-subtle">
                      {me.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={me.avatar}
                          alt={me.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Avatar
                          name={me.name}
                          size="lg"
                          className="!w-[80px] !h-[80px] !text-[24px] !rounded-none"
                        />
                      )}
                    </div>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        onPhotoPick(e.target.files?.[0]);
                        if (fileRef.current) fileRef.current.value = '';
                      }}
                    />
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-sm border border-border text-[11px] font-medium text-text-sub hover:border-accent hover:text-accent transition-colors"
                      >
                        <Upload className="w-3 h-3" /> Upload
                      </button>
                      {me.avatar && (
                        <button
                          type="button"
                          onClick={() =>
                            updateProfile.mutate({ avatar: '' })
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-sm border border-border text-[11px] font-medium text-text-sub hover:border-red hover:text-red transition-colors"
                        >
                          <Trash2 className="w-3 h-3" /> Remove
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 min-w-[280px] flex flex-col gap-3.5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <Field
                        label="Name"
                        required
                        error={errors.name?.message}
                      >
                        <Input {...register('name')} />
                      </Field>
                      <Field label="Email" hint="(read-only)">
                        <Input disabled {...register('email')} />
                      </Field>
                      <Field label="Role">
                        <Input disabled value={me.role} />
                      </Field>
                      <Field label="Gender">
                        <Controller
                          control={control}
                          name="gender"
                          render={({ field }) => (
                            <Select
                              value={field.value}
                              onValueChange={(v) => field.onChange(v)}
                              options={GENDER_OPTS as unknown as {
                                value: string;
                                label: string;
                              }[]}
                            />
                          )}
                        />
                      </Field>
                      <Field label="Date of birth">
                        <Input
                          type="date"
                          {...register('dateOfBirth')}
                        />
                      </Field>
                      <Field label="Nationality">
                        <Input
                          placeholder="e.g. Cambodian"
                          {...register('nationality')}
                        />
                      </Field>
                      <Field label="Job title / Position">
                        <Input
                          placeholder="e.g. Frontend Engineer"
                          {...register('jobTitle')}
                        />
                      </Field>
                      <Field label="Department">
                        <Input
                          placeholder="e.g. Engineering"
                          {...register('department')}
                        />
                      </Field>
                      <Field label="Employment type">
                        <Controller
                          control={control}
                          name="employmentType"
                          render={({ field }) => (
                            <Select
                              value={field.value}
                              onValueChange={(v) => field.onChange(v)}
                              options={EMPLOYMENT_OPTS as unknown as {
                                value: string;
                                label: string;
                              }[]}
                            />
                          )}
                        />
                      </Field>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="primary"
                        type="submit"
                        disabled={isSubmitting}
                      >
                        Save changes
                      </Button>
                      <Button
                        variant="outline"
                        type="button"
                        onClick={cancelEdit}
                        disabled={isSubmitting}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                </form>
              )}
            </Card>
              <TelegramIdentityCard />
            </>
          )}

          {pane === 'appearance' && (
            <>
              <Card
                title="Theme"
                sub="Light, dark, or follow your system"
              >
                <div className="grid grid-cols-3 gap-3 max-w-[500px]">
                  <ThemeOpt
                    active={theme === 'light'}
                    onClick={() => setThemePersisted('light')}
                    Icon={Sun}
                  >
                    Light
                  </ThemeOpt>
                  <ThemeOpt
                    active={theme === 'dark'}
                    onClick={() => setThemePersisted('dark')}
                    Icon={Moon}
                  >
                    Dark
                  </ThemeOpt>
                  <ThemeOpt
                    active={false}
                    onClick={() =>
                      setThemePersisted(
                        matchMedia('(prefers-color-scheme: dark)')
                          .matches
                          ? 'dark'
                          : 'light',
                      )
                    }
                    Icon={Monitor}
                  >
                    System
                  </ThemeOpt>
                </div>
              </Card>

              <Card title="Accent" sub="Pick the workspace accent color">
                <div className="flex gap-3 flex-wrap">
                  {ACCENTS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      aria-label={a.id}
                      onClick={() => setAccentPersisted(a.id)}
                      className={cn(
                        'relative w-10 h-10 rounded-full border-2 flex items-center justify-center bg-transparent p-0 transition-transform duration-[var(--dur)]',
                        'hover:scale-110',
                        accent === a.id
                          ? 'border-accent scale-110'
                          : 'border-border',
                      )}
                    >
                      <span
                        className="w-7 h-7 rounded-full block shadow-[inset_0_2px_4px_rgba(0,0,0,.2)]"
                        style={{ background: a.hex }}
                      />
                      {accent === a.id && (
                        <span className="absolute inset-0 flex items-center justify-center text-white font-bold text-[13px] drop-shadow-[0_1px_2px_rgba(0,0,0,.2)]">
                          ✓
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </Card>

              <Card title="Density" sub="Spacing of UI elements">
                <div className="flex gap-2">
                  {(['comfy', 'compact'] as Density[]).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDensityPersisted(d)}
                      className={cn(
                        'px-4 py-2 rounded-sm border-[1.5px] text-[13px] font-medium capitalize transition-colors',
                        density === d
                          ? 'border-accent bg-accent-50 text-accent-700 dark:bg-[rgba(99,102,241,.12)] dark:text-[var(--a-200)]'
                          : 'border-border text-text-sub hover:border-accent',
                      )}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </Card>

              <Card
                title={t('settings.language.title')}
                sub={t('settings.language.help')}
              >
                <div className="flex gap-2" data-testid="locale-switcher">
                  {LOCALES.map((l) => (
                    <button
                      key={l}
                      type="button"
                      lang={l}
                      data-locale={l}
                      aria-pressed={locale === l}
                      onClick={() => setLocalePersisted(l)}
                      className={cn(
                        'px-4 py-2 rounded-sm border-[1.5px] text-[13px] font-medium transition-colors',
                        locale === l
                          ? 'border-accent bg-accent-50 text-accent-700 dark:bg-[rgba(99,102,241,.12)] dark:text-[var(--a-200)]'
                          : 'border-border text-text-sub hover:border-accent',
                      )}
                    >
                      {t(l === 'km' ? 'settings.language.km' : 'settings.language.en')}
                    </button>
                  ))}
                </div>
              </Card>
            </>
          )}

          {pane === 'notifications' && <NotificationsPane />}

          {pane === 'security' && <SecurityPane />}

          {pane === 'data' && (
            <>
              <BackupExportCard />
              <BackupScheduleCard />
              <BackupImportCard />
              <BackupHistoryCard />
              <ClearDataCard />
            </>
          )}
        </main>
      </div>
    </>
  );
}

function ClearDataCard() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const clearData = useClearData();

  const handleOpen = () => {
    setPassword('');
    setShowPw(false);
    setOpen(true);
  };

  const handleClose = () => {
    if (clearData.isPending) return;
    setOpen(false);
    setPassword('');
  };

  const handleConfirm = async () => {
    try {
      await clearData.mutateAsync({ password });
      setOpen(false);
      setPassword('');
    } catch {
      // global api interceptor already toasted the error; keep modal open
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        title="Clear all application data"
        size="sm"
        footer={
          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              type="button"
              onClick={handleClose}
              disabled={clearData.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              type="button"
              onClick={handleConfirm}
              disabled={!password || clearData.isPending}
            >
              {clearData.isPending ? 'Clearing…' : 'Confirm & delete'}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 p-3 rounded-md bg-red-500/10 border border-red-500/30">
            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-[13px] text-red-600 dark:text-red-400 leading-relaxed">
              This action is <strong>permanent and cannot be undone.</strong>
            </p>
          </div>

          <div className="flex flex-col gap-2 text-[13px]">
            <p className="font-medium">The following will be permanently deleted:</p>
            <ul className="list-disc list-inside text-text-muted space-y-0.5 pl-1">
              <li>Projects, issues, and approvals</li>
              <li>Notes, wiki pages, and file storage</li>
              <li>Kanban boards and automation rules</li>
              <li>Spreadsheet workbooks and comments</li>
              <li>Reports, schedules, and run history</li>
              <li>Activity logs, notifications, and backups</li>
            </ul>
          </div>

          <div className="flex flex-col gap-2 text-[13px]">
            <p className="font-medium text-emerald-600 dark:text-emerald-400">
              The following will NOT be deleted:
            </p>
            <ul className="list-disc list-inside text-text-muted space-y-0.5 pl-1">
              <li>Your account (name, email, password)</li>
              <li>Profile settings and preferences</li>
              <li>API tokens and active sessions</li>
              <li>User roles and other accounts</li>
            </ul>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium uppercase tracking-[.06em] text-text-muted">
              Enter your password to confirm
            </label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && password) handleConfirm(); }}
                placeholder="Your current password"
                autoComplete="current-password"
                className="w-full h-9 px-3 pr-9 rounded-md border border-border bg-bg-input text-[13px] text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent transition-colors"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPw((s) => !s)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text transition-colors"
              >
                {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <section className="bg-bg-card border border-red-500/30 rounded-lg p-6 flex flex-col gap-4">
        <header className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-[15px] font-semibold text-red-600 dark:text-red-400">
              Danger Zone
            </h3>
            <p className="text-[13px] text-text-muted mt-0.5">
              Irreversible actions that affect all application data
            </p>
          </div>
        </header>

        <div className="flex items-start justify-between gap-4 flex-wrap border border-border rounded-md p-4">
          <div>
            <p className="text-[13px] font-medium">Clear all application data</p>
            <p className="text-[12px] text-text-muted mt-0.5">
              Permanently delete all projects, issues, notes, files, and every
              other business record. Your account credentials are preserved.
            </p>
          </div>
          <Button variant="danger" type="button" onClick={handleOpen}>
            <Trash2 className="w-3.5 h-3.5" /> Clear data
          </Button>
        </div>
      </section>
    </>
  );
}

const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Required'),
    newPassword: z.string().min(8, 'At least 8 characters').max(72),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

const PasswordField = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }
>(function PasswordField({ label, error, ...props }, ref) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} error={error}>
      <div className="relative">
        <Input type={show ? 'text' : 'password'} className="pr-9" ref={ref} {...props} />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShow((s) => !s)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text transition-colors"
        >
          {show ? (
            <EyeOff className="w-3.5 h-3.5" />
          ) : (
            <Eye className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    </Field>
  );
});

function ChangePasswordCard() {
  const changePassword = useChangePassword();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(ChangePasswordSchema),
  });

  const onSubmit = handleSubmit(async (v) => {
    await changePassword.mutateAsync({
      currentPassword: v.currentPassword,
      newPassword: v.newPassword,
    });
    reset();
  });

  return (
    <Card title="Change password" sub="Update your login password">
      <form onSubmit={onSubmit} className="flex flex-col gap-3.5 max-w-[480px]">
        <PasswordField
          label="Current password"
          error={errors.currentPassword?.message}
          {...register('currentPassword')}
        />
        <PasswordField
          label="New password"
          error={errors.newPassword?.message}
          {...register('newPassword')}
        />
        <PasswordField
          label="Confirm new password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <div>
          <Button variant="primary" type="submit" disabled={isSubmitting}>
            Update password
          </Button>
        </div>
      </form>
    </Card>
  );
}

function TwoFACard() {
  const me = useAuthStore((s) => s.user)!;
  const setup = useSetup2FA();
  const confirm = useConfirm2FA();
  const disable = useDisable2FA();

  const [step, setStep] = useState<'idle' | 'scan' | 'disable'>(
    me.twoFactorEnabled ? 'idle' : 'idle',
  );
  const [qrData, setQrData] = useState<{
    qrDataUrl: string;
    secret: string;
  } | null>(null);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);

  const startSetup = async () => {
    const data = await setup.mutateAsync(undefined);
    setQrData(data);
    setCode('');
    setStep('scan');
  };

  const handleConfirm = async () => {
    await confirm.mutateAsync(code);
    setStep('idle');
    setQrData(null);
    setCode('');
  };

  const handleDisable = async () => {
    await disable.mutateAsync(code);
    setStep('idle');
    setCode('');
  };

  const copySecret = () => {
    if (!qrData) return;
    navigator.clipboard.writeText(qrData.secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const enabled = me.twoFactorEnabled;

  return (
    <Card
      title="Two-factor authentication"
      sub="Add a second layer of security to your account using an authenticator app"
    >
      {step === 'idle' && !enabled && (
        <div className="flex flex-col gap-3 max-w-[480px]">
          <p className="text-[13px] text-text-muted leading-relaxed">
            Once enabled, you will be asked for a 6-digit code from your
            authenticator app each time you sign in.
          </p>
          <div>
            <Button
              variant="primary"
              onClick={startSetup}
              disabled={setup.isPending}
            >
              <Shield className="w-3.5 h-3.5" /> Enable 2FA
            </Button>
          </div>
        </div>
      )}

      {step === 'idle' && enabled && (
        <div className="flex flex-col gap-3 max-w-[480px]">
          <div className="flex items-center gap-2 text-[13px] font-medium text-emerald-500">
            <Check className="w-4 h-4" /> 2FA is active on your account
          </div>
          <p className="text-[13px] text-text-muted">
            To disable it, enter your current authenticator code below.
          </p>
          <div className="flex gap-2 items-end">
            <Field label="Authenticator code">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                className="font-mono tracking-widest w-32"
              />
            </Field>
            <Button
              variant="danger"
              onClick={handleDisable}
              disabled={code.length < 6 || disable.isPending}
            >
              Disable 2FA
            </Button>
          </div>
        </div>
      )}

      {step === 'scan' && qrData && (
        <div className="flex flex-col gap-4 max-w-[480px]">
          <p className="text-[13px] text-text-muted leading-relaxed">
            Scan this QR code with your authenticator app (Google Authenticator,
            Authy, 1Password, etc.), then enter the 6-digit code to confirm.
          </p>
          <div className="flex gap-6 items-start flex-wrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrData.qrDataUrl}
              alt="2FA QR code"
              className="w-[160px] h-[160px] rounded-md border border-border bg-white p-2"
            />
            <div className="flex flex-col gap-2 flex-1 min-w-[200px]">
              <p className="text-[12px] text-text-muted">
                Can&apos;t scan? Enter this key manually:
              </p>
              <div className="flex items-center gap-2">
                <code className="text-[11px] font-mono bg-bg-subtle border border-border rounded px-2 py-1.5 break-all flex-1">
                  {qrData.secret}
                </code>
                <button
                  type="button"
                  onClick={copySecret}
                  className="p-1.5 rounded border border-border text-text-muted hover:text-accent hover:border-accent transition-colors flex-shrink-0"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>
          <div className="flex gap-2 items-end">
            <Field label="Enter code from app">
              <Input
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                placeholder="000000"
                maxLength={6}
                className="font-mono tracking-widest w-32"
              />
            </Field>
            <Button
              variant="primary"
              onClick={handleConfirm}
              disabled={code.length < 6 || confirm.isPending}
            >
              Verify &amp; enable
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setStep('idle');
                setQrData(null);
                setCode('');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function ApiTokensCard() {
  const f = useFormat();
  const { data: tokens, isLoading } = useApiTokens();
  const create = useCreateApiToken();
  const revoke = useRevokeApiToken();

  const [newName, setNewName] = useState('');
  const [justCreated, setJustCreated] = useState<{
    token: string;
    name: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const result = await create.mutateAsync(newName.trim());
    setJustCreated({ token: result.token, name: result.name });
    setNewName('');
  };

  const copyToken = () => {
    if (!justCreated) return;
    navigator.clipboard.writeText(justCreated.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card
      title="Personal access tokens"
      sub="Tokens for authenticating with the UnifyOps API from scripts or integrations"
    >
      {justCreated && (
        <div className="flex flex-col gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-md">
          <p className="text-[12px] font-medium text-emerald-600 dark:text-emerald-400">
            Token created — copy it now. It will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="text-[11px] font-mono bg-bg-card border border-border rounded px-2 py-1.5 break-all flex-1">
              {justCreated.token}
            </code>
            <button
              type="button"
              onClick={copyToken}
              className="p-1.5 rounded border border-border text-text-muted hover:text-accent hover:border-accent transition-colors flex-shrink-0"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setJustCreated(null)}
            className="text-[11px] text-text-muted underline self-start"
          >
            I&apos;ve copied it, dismiss
          </button>
        </div>
      )}

      <div className="flex gap-2 items-center">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Token name (e.g. CI deploy)"
          className="max-w-[260px]"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCreate();
          }}
        />
        <Button
          variant="primary"
          onClick={handleCreate}
          disabled={!newName.trim() || create.isPending}
        >
          <KeyRound className="w-3.5 h-3.5" /> Generate token
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-1.5 animate-pulse">
          {[1, 2].map((i) => (
            <div key={i} className="h-10 rounded bg-bg-hover" />
          ))}
        </div>
      ) : tokens && tokens.length > 0 ? (
        <div className="overflow-hidden border border-border rounded-md">
          <div className="grid grid-cols-[1fr_auto_auto] items-center bg-bg-subtle px-4 py-2 text-[11px] font-semibold uppercase tracking-[.06em] text-text-muted">
            <span>Name</span>
            <span className="pr-4">Prefix</span>
            <span>Created</span>
          </div>
          {tokens.map((t) => (
            <div
              key={t._id}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center px-4 py-2.5 border-t border-border gap-3"
            >
              <span className="text-[13px] font-medium truncate">{t.name}</span>
              <code className="text-[11px] font-mono text-text-muted bg-bg-subtle border border-border rounded px-1.5 py-0.5">
                {t.prefix}…
              </code>
              <span className="text-[11px] text-text-muted whitespace-nowrap">
                {f.date(t.createdAt)}
              </span>
              <button
                type="button"
                onClick={() => revoke.mutate(t._id)}
                className="text-[11px] text-red-500 hover:text-red-600 transition-colors"
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-text-muted italic">
          No tokens yet — generate one above.
        </p>
      )}

      <p className="text-[11.5px] text-text-muted">
        Use tokens in the{' '}
        <code className="font-mono">Authorization: Bearer prs_…</code> header
        when calling the API.
      </p>
    </Card>
  );
}

function SecurityPane() {
  return (
    <>
      <ChangePasswordCard />
      <TwoFACard />
      <ApiTokensCard />
    </>
  );
}

function NotificationsPane() {
  const { data: prefs, isLoading } = useNotifPrefs();
  const update = useUpdateNotifPrefs();
  const [sound, setSound] = useState(() => isSoundEnabled());

  const toggle = (key: NotifType, channel: 'inApp' | 'email') => {
    const current = prefs?.[key];
    const next = !(current?.[channel] ?? (channel === 'inApp'));
    update.mutate({ [key]: { [channel]: next } });
  };

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    setSoundEnabled(next);
    if (next) playPing(true);
  };

  return (
    <Card
      title="Notifications"
      sub="Choose which events should reach you and how."
    >
      <div className="flex items-center justify-between gap-4 px-4 py-3 border border-border rounded-md">
        <div className="min-w-0 pr-4">
          <div className="text-[13px] font-medium">
            Play sound on new notifications
          </div>
          <div className="text-[12px] text-text-muted mt-0.5">
            A short chime when a notification arrives. Stored on this device.
          </div>
        </div>
        <Toggle
          checked={sound}
          onChange={toggleSound}
          ariaLabel="Play sound on new notifications"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 rounded-sm bg-bg-hover" />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden border border-border rounded-md">
          <div className="grid grid-cols-[1fr_72px_72px] items-center bg-bg-subtle px-4 py-2 text-[11px] font-semibold uppercase tracking-[.06em] text-text-muted">
            <span>Event</span>
            <span className="text-center">In app</span>
            <span className="text-center">Email</span>
          </div>
          {NOTIF_PREF_TYPES.map(({ key, label, hint }) => {
            const pref = prefs?.[key] ?? { inApp: true, email: false };
            return (
              <div
                key={key}
                className="grid grid-cols-[1fr_72px_72px] items-center px-4 py-3 border-t border-border first:border-t-0"
              >
                <div className="min-w-0 pr-4">
                  <div className="text-[13px] font-medium">{label}</div>
                  <div className="text-[12px] text-text-muted mt-0.5">
                    {hint}
                  </div>
                </div>
                <div className="flex justify-center">
                  <Toggle
                    checked={pref.inApp}
                    onChange={() => toggle(key, 'inApp')}
                    ariaLabel={`${label} in app`}
                  />
                </div>
                <div className="flex justify-center">
                  <Toggle
                    checked={pref.email}
                    onChange={() => toggle(key, 'email')}
                    ariaLabel={`${label} email`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[11.5px] text-text-muted">
        Email is sent only on new events (not on repeated activity within the
        5-minute grouping window). Configure SMTP on the server to enable
        delivery; without SMTP, emails are logged but not sent.
      </p>
    </Card>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
  ariaLabel,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        'relative w-9 h-5 rounded-full transition-colors duration-[var(--dur)]',
        checked ? 'bg-accent' : 'bg-bg-hover',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-[var(--dur)]',
          checked && 'translate-x-4',
        )}
      />
    </button>
  );
}

function NavItem({
  active,
  onClick,
  Icon,
  children,
  danger,
}: React.PropsWithChildren<{
  active?: boolean;
  onClick: () => void;
  Icon: React.ComponentType<{ className?: string }>;
  danger?: boolean;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2.5 px-3 py-2 rounded-sm text-[13px] font-medium transition-all duration-[var(--dur)]',
        active
          ? 'bg-accent-50 text-accent-700 dark:bg-[rgba(99,102,241,.12)] dark:text-[var(--a-200)]'
          : 'text-text-sub hover:bg-bg-hover hover:text-text',
        danger && !active && 'hover:text-red',
      )}
    >
      <Icon className="w-[15px] h-[15px]" /> {children}
    </button>
  );
}

function Card({
  title,
  sub,
  right,
  children,
}: React.PropsWithChildren<{
  title: string;
  sub?: string;
  right?: React.ReactNode;
}>) {
  return (
    <section className="bg-bg-card border border-border rounded-lg p-6 flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold">{title}</h3>
          {sub && <p className="text-[13px] text-text-muted mt-0.5">{sub}</p>}
        </div>
        {right && <div className="flex-shrink-0">{right}</div>}
      </header>
      {children}
    </section>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[11px] font-medium uppercase tracking-[.06em] text-text-muted">
        {label}
      </span>
      <span
        className={cn(
          'text-[13px] truncate',
          value ? 'text-text' : 'text-text-muted italic',
        )}
      >
        {value || 'Not set'}
      </span>
    </div>
  );
}

function ThemeOpt({
  active,
  onClick,
  Icon,
  children,
}: React.PropsWithChildren<{
  active: boolean;
  onClick: () => void;
  Icon: React.ComponentType<{ className?: string }>;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-2 px-3 py-[18px] rounded-md border-[1.5px] cursor-pointer transition-all duration-[var(--dur)]',
        'bg-bg-subtle border-border hover:border-accent',
        active &&
          'border-accent bg-accent-50 text-accent dark:bg-[rgba(99,102,241,.1)]',
      )}
    >
      <Icon
        className={cn(
          'w-6 h-6',
          active ? 'text-accent' : 'text-text-muted',
        )}
      />
      <span
        className={cn(
          'text-[13px] font-medium',
          active && 'text-accent',
        )}
      >
        {children}
      </span>
    </button>
  );
}
