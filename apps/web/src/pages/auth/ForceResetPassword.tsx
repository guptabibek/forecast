import { zodResolver } from '@hookform/resolvers/zod';
import { authService } from '@services/api';
import { useAuthStore } from '@stores/auth.store';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Navigate, useNavigate } from 'react-router-dom';
import { z } from 'zod';

const resetSchema = z
  .object({
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Must contain an uppercase letter')
      .regex(/[a-z]/, 'Must contain a lowercase letter')
      .regex(/\d/, 'Must contain a number')
      .regex(/[@$!%*?&]/, 'Must contain a special character (@$!%*?&)'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type ResetForm = z.infer<typeof resetSchema>;

export default function ForceResetPassword() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetForm>({ resolver: zodResolver(resetSchema) });

  // If user is not authenticated or doesn't need reset, redirect
  if (!user) return <Navigate to="/login" replace />;
  if (!user.mustResetPassword) return <Navigate to="/dashboard" replace />;

  const onSubmit = async (data: ResetForm) => {
    setIsLoading(true);
    try {
      await authService.forceResetPassword(data.password);
      toast.success('Password updated successfully. Please sign in again.');
      await logout();
      navigate('/login', { replace: true });
    } catch {
      toast.error('Failed to update password. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary-50 dark:bg-secondary-900 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-secondary-800 rounded-2xl shadow-xl p-8">
          <div className="mb-8 text-center">
            <div className="w-16 h-16 bg-warning-50 dark:bg-warning-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-warning-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold">Set your password</h2>
            <p className="text-secondary-500 mt-2">
              You're signed in with a temporary password. Please set a new password to continue.
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div>
              <label htmlFor="password" className="label">New password</label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                className={`input ${errors.password ? 'input-error' : ''}`}
                placeholder="••••••••"
                {...register('password')}
              />
              {errors.password && (
                <p className="text-sm text-error-500 mt-1">{errors.password.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="confirmPassword" className="label">Confirm password</label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                className={`input ${errors.confirmPassword ? 'input-error' : ''}`}
                placeholder="••••••••"
                {...register('confirmPassword')}
              />
              {errors.confirmPassword && (
                <p className="text-sm text-error-500 mt-1">{errors.confirmPassword.message}</p>
              )}
            </div>

            <div className="bg-secondary-50 dark:bg-secondary-700/50 rounded-lg p-3 text-sm text-secondary-600 dark:text-secondary-300">
              <p className="font-medium mb-1">Password requirements:</p>
              <ul className="space-y-0.5 list-disc list-inside">
                <li>At least 8 characters</li>
                <li>One uppercase letter</li>
                <li>One lowercase letter</li>
                <li>One number</li>
                <li>One special character (@$!%*?&)</li>
              </ul>
            </div>

            <button type="submit" disabled={isLoading} className="btn-primary w-full py-3">
              {isLoading ? (
                <svg className="animate-spin h-5 w-5 text-white mx-auto" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                'Set new password'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
