import { getRoleLabel } from '@/permissions';
import {
    CameraIcon,
    ClockIcon,
    ComputerDesktopIcon,
    DevicePhoneMobileIcon,
    KeyIcon,
    ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import { zodResolver } from '@hookform/resolvers/zod';
import { authService, userService } from '@services/api';
import { useAuthStore } from '@stores/auth.store';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { format } from 'date-fns';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { z } from 'zod';

const profileSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
  timezone: z.string().optional(),
  language: z.string().optional(),
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain an uppercase letter')
      .regex(/[a-z]/, 'Password must contain a lowercase letter')
      .regex(/[0-9]/, 'Password must contain a number'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

type ProfileFormData = z.infer<typeof profileSchema>;
type PasswordFormData = z.infer<typeof passwordSchema>;

interface Session {
  id: string;
  device: string;
  browser: string;
  ip: string;
  location: string;
  lastActive: string;
  isCurrent: boolean;
}

function detectCurrentSession(): Session {
  const ua = navigator.userAgent;
  let device = 'Unknown Device';
  let browser = 'Unknown Browser';

  if (/Windows/.test(ua)) device = 'Windows PC';
  else if (/Macintosh/.test(ua)) device = 'Mac';
  else if (/iPhone/.test(ua)) device = 'iPhone';
  else if (/Android/.test(ua)) device = 'Android';
  else if (/Linux/.test(ua)) device = 'Linux PC';

  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua)) browser = 'Safari';

  return {
    id: 'current',
    device,
    browser,
    ip: '—',
    location: '—',
    lastActive: new Date().toISOString(),
    isCurrent: true,
  };
}

export default function Profile() {
  const queryClient = useQueryClient();
  const { user, checkAuth } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'profile' | 'security'>('profile');
  const [showAvatarEditor, setShowAvatarEditor] = useState(false);
  const [avatarUrlInput, setAvatarUrlInput] = useState(user?.avatarUrl || '');

  const sessionsQuery = useQuery({
    queryKey: ['auth-sessions'],
    queryFn: () => authService.getSessions(),
    staleTime: 60_000,
  });

  const sessions: Session[] = sessionsQuery.data?.length
    ? sessionsQuery.data.map((session) => {
        const ua = session.userAgent || '';
        let device = 'Unknown Device';
        let browser = 'Unknown Browser';

        if (/Windows/.test(ua)) device = 'Windows PC';
        else if (/Macintosh/.test(ua)) device = 'Mac';
        else if (/iPhone/.test(ua)) device = 'iPhone';
        else if (/Android/.test(ua)) device = 'Android';
        else if (/Linux/.test(ua)) device = 'Linux PC';

        if (/Edg\//.test(ua)) browser = 'Edge';
        else if (/Chrome\//.test(ua)) browser = 'Chrome';
        else if (/Firefox\//.test(ua)) browser = 'Firefox';
        else if (/Safari\//.test(ua)) browser = 'Safari';

        return {
          id: session.id,
          device,
          browser,
          ip: session.ipAddress || '—',
          location: '—',
          lastActive: session.createdAt,
          isCurrent: session.isCurrent,
        };
      })
    : [detectCurrentSession()];

  // Update profile mutation
  const updateProfileMutation = useMutation({
    mutationFn: (data: ProfileFormData) => userService.updateProfile(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user'] });
      checkAuth(); // Refresh user data in store
      toast.success('Profile updated successfully');
    },
    onError: () => {
      toast.error('Failed to update profile');
    },
  });

  const updateAvatarMutation = useMutation({
    mutationFn: (avatarUrl?: string) => userService.uploadAvatar(avatarUrl),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['user'] });
      await checkAuth();
      setShowAvatarEditor(false);
      toast.success('Avatar updated successfully');
    },
    onError: (error: unknown) => {
      const message =
        error && typeof error === 'object'
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message || 'Failed to update avatar'
          : 'Failed to update avatar';
      toast.error(message);
    },
  });

  // Change password mutation
  const changePasswordMutation = useMutation({
    mutationFn: (data: PasswordFormData) => authService.changePassword({
      currentPassword: data.currentPassword,
      newPassword: data.newPassword,
    }),
    onSuccess: () => {
      toast.success('Password changed successfully');
      resetPasswordForm();
    },
    onError: (error: unknown) => {
      const message =
        error && typeof error === 'object'
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message || 'Failed to change password'
          : 'Failed to change password';
      toast.error(message);
    },
  });

  // Revoke session mutation
  const revokeSessionMutation = useMutation({
    mutationFn: (sessionId: string) => authService.revokeSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth-sessions'] });
      toast.success('Session revoked');
    },
    onError: () => {
      toast.error('Failed to revoke session');
    },
  });

  // Profile form
  const {
    register: registerProfile,
    handleSubmit: handleSubmitProfile,
    formState: { errors: profileErrors, isDirty: profileIsDirty },
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      firstName: user?.firstName || '',
      lastName: user?.lastName || '',
      email: user?.email || '',
      phone: '',
      timezone: 'America/New_York',
      language: 'en',
    },
  });

  // Password form
  const {
    register: registerPassword,
    handleSubmit: handleSubmitPassword,
    reset: resetPasswordForm,
    formState: { errors: passwordErrors },
  } = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
  });

  const onProfileSubmit = (data: ProfileFormData) => {
    updateProfileMutation.mutate(data);
  };

  const onPasswordSubmit = (data: PasswordFormData) => {
    changePasswordMutation.mutate(data);
  };

  useEffect(() => {
    setAvatarUrlInput(user?.avatarUrl || '');
  }, [user?.avatarUrl]);

  const handleAvatarSave = () => {
    updateAvatarMutation.mutate(avatarUrlInput.trim() || undefined);
  };

  const handleAvatarReset = () => {
    setAvatarUrlInput('');
    updateAvatarMutation.mutate(undefined);
  };

  const getDeviceIcon = (device: string) => {
    if (device.toLowerCase().includes('phone') || device.toLowerCase().includes('iphone')) {
      return <DevicePhoneMobileIcon className="w-5 h-5" />;
    }
    return <ComputerDesktopIcon className="w-5 h-5" />;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">My Profile</h1>
        <p className="text-secondary-500 mt-1">
          Manage your account settings and security
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-secondary-200 dark:border-secondary-700">
        <nav className="flex gap-8">
          <button
            onClick={() => setActiveTab('profile')}
            className={clsx(
              'pb-4 text-sm font-medium border-b-2 transition-colors',
              activeTab === 'profile'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-secondary-500 hover:text-secondary-700',
            )}
          >
            Profile
          </button>
          <button
            onClick={() => setActiveTab('security')}
            className={clsx(
              'pb-4 text-sm font-medium border-b-2 transition-colors',
              activeTab === 'security'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-secondary-500 hover:text-secondary-700',
            )}
          >
            Security
          </button>
        </nav>
      </div>

      {activeTab === 'profile' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Avatar Card */}
          <div className="lg:col-span-1">
            <div className="card p-6 text-center">
              <div className="relative inline-block">
                <div className="w-32 h-32 rounded-full overflow-hidden bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center mx-auto">
                  {user?.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt={`${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'User avatar'}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-4xl font-bold text-primary-600">
                      {user?.firstName?.[0]}
                      {user?.lastName?.[0]}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowAvatarEditor((current) => !current)}
                  className="absolute bottom-0 right-0 p-2 bg-white dark:bg-secondary-700 rounded-full shadow-md hover:shadow-lg transition-shadow"
                >
                  <CameraIcon className="w-5 h-5 text-secondary-600" />
                </button>
              </div>
              <h2 className="text-xl font-semibold mt-4">
                {user?.firstName} {user?.lastName}
              </h2>
              <p className="text-secondary-500">{user?.email}</p>
              <span className="badge badge-primary mt-2">{getRoleLabel(user?.role)}</span>
              {showAvatarEditor && (
                <div className="mt-4 text-left space-y-3">
                  <label className="label">Avatar Image URL</label>
                  <input
                    type="url"
                    value={avatarUrlInput}
                    onChange={(event) => setAvatarUrlInput(event.target.value)}
                    className="input w-full"
                    placeholder="https://example.com/avatar.png"
                  />
                  <p className="text-xs text-secondary-500">
                    Use a secure image URL. Leave empty to fall back to initials.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleAvatarSave}
                      disabled={updateAvatarMutation.isPending}
                      className="btn-primary flex-1"
                    >
                      {updateAvatarMutation.isPending ? 'Saving...' : 'Save Avatar'}
                    </button>
                    <button
                      type="button"
                      onClick={handleAvatarReset}
                      disabled={updateAvatarMutation.isPending}
                      className="btn-secondary"
                    >
                      Use Initials
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Profile Form */}
          <div className="lg:col-span-2">
            <div className="card p-6">
              <h3 className="text-lg font-semibold mb-4">Personal Information</h3>
              <form onSubmit={handleSubmitProfile(onProfileSubmit)} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="label">First Name</label>
                    <input
                      type="text"
                      {...registerProfile('firstName')}
                      className="input w-full"
                    />
                    {profileErrors.firstName && (
                      <p className="text-sm text-red-500 mt-1">
                        {profileErrors.firstName.message}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="label">Last Name</label>
                    <input
                      type="text"
                      {...registerProfile('lastName')}
                      className="input w-full"
                    />
                    {profileErrors.lastName && (
                      <p className="text-sm text-red-500 mt-1">
                        {profileErrors.lastName.message}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <label className="label">Email Address</label>
                  <input
                    type="email"
                    {...registerProfile('email')}
                    className="input w-full"
                    disabled
                  />
                  <p className="text-sm text-secondary-500 mt-1">
                    Contact your admin to change your email address
                  </p>
                </div>

                <div>
                  <label className="label">Phone Number (optional)</label>
                  <input
                    type="tel"
                    {...registerProfile('phone')}
                    className="input w-full"
                    placeholder="+1 (555) 000-0000"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="label">Timezone</label>
                    <select {...registerProfile('timezone')} className="input w-full">
                      <option value="America/New_York">Eastern Time (ET)</option>
                      <option value="America/Chicago">Central Time (CT)</option>
                      <option value="America/Denver">Mountain Time (MT)</option>
                      <option value="America/Los_Angeles">Pacific Time (PT)</option>
                      <option value="UTC">UTC</option>
                      <option value="Europe/London">London (GMT)</option>
                      <option value="Europe/Paris">Paris (CET)</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Language</label>
                    <select {...registerProfile('language')} className="input w-full">
                      <option value="en">English</option>
                      <option value="es">Spanish</option>
                      <option value="fr">French</option>
                      <option value="de">German</option>
                    </select>
                  </div>
                </div>

                <div className="flex justify-end pt-4">
                  <button
                    type="submit"
                    disabled={!profileIsDirty || updateProfileMutation.isPending}
                    className="btn-primary"
                  >
                    {updateProfileMutation.isPending ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'security' && (
        <div className="space-y-6">
          {/* Change Password */}
          <div className="card p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-primary-100 dark:bg-primary-900/30">
                <KeyIcon className="w-5 h-5 text-primary-600" />
              </div>
              <div>
                <h3 className="font-semibold">Change Password</h3>
                <p className="text-sm text-secondary-500">
                  Update your password regularly to keep your account secure
                </p>
              </div>
            </div>

            <form
              onSubmit={handleSubmitPassword(onPasswordSubmit)}
              className="space-y-4 max-w-md"
            >
              <div>
                <label className="label">Current Password</label>
                <input
                  type="password"
                  {...registerPassword('currentPassword')}
                  className="input w-full"
                />
                {passwordErrors.currentPassword && (
                  <p className="text-sm text-red-500 mt-1">
                    {passwordErrors.currentPassword.message}
                  </p>
                )}
              </div>

              <div>
                <label className="label">New Password</label>
                <input
                  type="password"
                  {...registerPassword('newPassword')}
                  className="input w-full"
                />
                {passwordErrors.newPassword && (
                  <p className="text-sm text-red-500 mt-1">
                    {passwordErrors.newPassword.message}
                  </p>
                )}
              </div>

              <div>
                <label className="label">Confirm New Password</label>
                <input
                  type="password"
                  {...registerPassword('confirmPassword')}
                  className="input w-full"
                />
                {passwordErrors.confirmPassword && (
                  <p className="text-sm text-red-500 mt-1">
                    {passwordErrors.confirmPassword.message}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={changePasswordMutation.isPending}
                className="btn-primary"
              >
                {changePasswordMutation.isPending
                  ? 'Changing...'
                  : 'Change Password'}
              </button>
            </form>
          </div>

          {/* Two-Factor Authentication */}
          <div className="card p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                  <ShieldCheckIcon className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <h3 className="font-semibold">Two-Factor Authentication</h3>
                  <p className="text-sm text-secondary-500">
                    Add an extra layer of security to your account
                  </p>
                </div>
              </div>
              <button
                className="btn-secondary"
                onClick={() => toast('Two-factor authentication setup is not yet available', { icon: '🔒' })}
              >
                Enable 2FA
              </button>
            </div>
          </div>

          {/* Active Sessions */}
          <div className="card p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                <ComputerDesktopIcon className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <h3 className="font-semibold">Active Sessions</h3>
                <p className="text-sm text-secondary-500">
                  Manage your active sessions across devices
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between p-4 bg-secondary-50 dark:bg-secondary-800/50 rounded-lg"
                >
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-lg bg-white dark:bg-secondary-700">
                      {getDeviceIcon(session.device)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {session.device} - {session.browser}
                        </span>
                        {session.isCurrent && (
                          <span className="badge badge-success">Current</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-sm text-secondary-500 mt-0.5">
                        <span>{session.location}</span>
                        <span>•</span>
                        <span>{session.ip}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <ClockIcon className="w-3 h-3" />
                          {session.isCurrent
                            ? 'Active now'
                            : format(new Date(session.lastActive), 'MMM d, h:mm a')}
                        </span>
                      </div>
                    </div>
                  </div>
                  {!session.isCurrent && (
                    <button
                      onClick={() => revokeSessionMutation.mutate(session.id)}
                      disabled={revokeSessionMutation.isPending}
                      className="btn-secondary btn-sm text-red-500 hover:text-red-600"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button
              className="btn-secondary w-full mt-4 text-red-500 hover:text-red-600"
              onClick={async () => {
                try {
                  await authService.revokeAllSessions();
                  queryClient.invalidateQueries({ queryKey: ['auth-sessions'] });
                  toast.success('All other sessions signed out');
                } catch {
                  toast.error('Failed to sign out other sessions');
                }
              }}
            >
              Sign out all other sessions
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
