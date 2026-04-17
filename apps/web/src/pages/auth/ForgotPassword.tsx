import { ArrowLeftIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { zodResolver } from '@hookform/resolvers/zod';
import { authService } from '@services/api';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { z } from 'zod';

const emailSchema = z.object({
  email: z.string().email('Please enter a valid email'),
});
type EmailForm = z.infer<typeof emailSchema>;

const otpResetSchema = z
  .object({
    otp: z.string().length(6, 'OTP must be 6 digits').regex(/^\d{6}$/, 'OTP must be 6 digits'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Must contain an uppercase letter')
      .regex(/[a-z]/, 'Must contain a lowercase letter')
      .regex(/\d/, 'Must contain a number')
      .regex(/[@$!%*?&]/, 'Must contain a special character'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
type OtpResetForm = z.infer<typeof otpResetSchema>;

type Step = 'email' | 'otp' | 'success';

export default function ForgotPassword() {
  const [step, setStep] = useState<Step>('email');
  const [isLoading, setIsLoading] = useState(false);
  const emailRef = useRef('');
  const [resendCooldown, setResendCooldown] = useState(0);

  const emailForm = useForm<EmailForm>({ resolver: zodResolver(emailSchema) });
  const otpForm = useForm<OtpResetForm>({ resolver: zodResolver(otpResetSchema) });

  const startResendCooldown = () => {
    setResendCooldown(60);
    const iv = setInterval(() => {
      setResendCooldown((c) => {
        if (c <= 1) { clearInterval(iv); return 0; }
        return c - 1;
      });
    }, 1000);
  };

  const onEmailSubmit = async (data: EmailForm) => {
    setIsLoading(true);
    try {
      await authService.forgotPassword(data.email);
    } catch {
      // silent — prevent email enumeration
    }
    emailRef.current = data.email;
    setStep('otp');
    startResendCooldown();
    setIsLoading(false);
  };

  const onResendOtp = async () => {
    if (resendCooldown > 0) return;
    try {
      await authService.forgotPassword(emailRef.current);
      toast.success('New OTP sent');
      startResendCooldown();
    } catch {
      toast.error('Failed to resend OTP');
    }
  };

  const onOtpSubmit = async (data: OtpResetForm) => {
    setIsLoading(true);
    try {
      await authService.resetPassword({
        email: emailRef.current,
        otp: data.otp,
        password: data.password,
      });
      setStep('success');
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Invalid or expired OTP';
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  if (step === 'success') {
    return (
      <div className="bg-white dark:bg-secondary-800 rounded-2xl shadow-xl p-8 text-center">
        <div className="w-16 h-16 bg-success-50 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircleIcon className="w-8 h-8 text-success-500" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Password updated</h2>
        <p className="text-secondary-500 mb-6">Your password has been reset. Please sign in with your new password.</p>
        <Link to="/login" className="btn-primary">Back to sign in</Link>
      </div>
    );
  }

  if (step === 'otp') {
    return (
      <div>
        <div className="bg-white dark:bg-secondary-800 rounded-2xl shadow-xl p-8">
          <button
            type="button"
            onClick={() => setStep('email')}
            className="inline-flex items-center gap-2 text-sm text-secondary-500 hover:text-secondary-700 mb-6"
          >
            <ArrowLeftIcon className="w-4 h-4" /> Back
          </button>

          <div className="mb-8">
            <h2 className="text-2xl font-bold">Enter verification code</h2>
            <p className="text-secondary-500 mt-2">
              We've sent a 6-digit code to <strong>{emailRef.current}</strong>
            </p>
          </div>

          <form onSubmit={otpForm.handleSubmit(onOtpSubmit)} className="space-y-5">
            <div>
              <label htmlFor="otp" className="label">Verification code</label>
              <input
                id="otp"
                type="text"
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                className={`input text-center text-2xl tracking-[0.5em] font-mono ${otpForm.formState.errors.otp ? 'input-error' : ''}`}
                placeholder="000000"
                {...otpForm.register('otp')}
              />
              {otpForm.formState.errors.otp && (
                <p className="text-sm text-error-500 mt-1">{otpForm.formState.errors.otp.message}</p>
              )}
              <div className="mt-2 text-sm text-secondary-500">
                Didn't receive the code?{' '}
                <button
                  type="button"
                  disabled={resendCooldown > 0}
                  onClick={onResendOtp}
                  className="text-primary-600 hover:text-primary-700 disabled:text-secondary-400"
                >
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend'}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="password" className="label">New password</label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                className={`input ${otpForm.formState.errors.password ? 'input-error' : ''}`}
                placeholder="••••••••"
                {...otpForm.register('password')}
              />
              {otpForm.formState.errors.password && (
                <p className="text-sm text-error-500 mt-1">{otpForm.formState.errors.password.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="confirmPassword" className="label">Confirm password</label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                className={`input ${otpForm.formState.errors.confirmPassword ? 'input-error' : ''}`}
                placeholder="••••••••"
                {...otpForm.register('confirmPassword')}
              />
              {otpForm.formState.errors.confirmPassword && (
                <p className="text-sm text-error-500 mt-1">{otpForm.formState.errors.confirmPassword.message}</p>
              )}
            </div>

            <button type="submit" disabled={isLoading} className="btn-primary w-full py-3">
              {isLoading ? (
                <svg className="animate-spin h-5 w-5 text-white mx-auto" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                'Reset password'
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Step: email
  return (
    <div>
      <div className="bg-white dark:bg-secondary-800 rounded-2xl shadow-xl p-8">
        <Link to="/login" className="inline-flex items-center gap-2 text-sm text-secondary-500 hover:text-secondary-700 mb-6">
          <ArrowLeftIcon className="w-4 h-4" /> Back to sign in
        </Link>

        <div className="mb-8">
          <h2 className="text-2xl font-bold">Forgot your password?</h2>
          <p className="text-secondary-500 mt-2">Enter your email and we'll send you a verification code.</p>
        </div>

        <form onSubmit={emailForm.handleSubmit(onEmailSubmit)} className="space-y-6">
          <div>
            <label htmlFor="email" className="label">Email address</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className={`input ${emailForm.formState.errors.email ? 'input-error' : ''}`}
              placeholder="you@company.com"
              {...emailForm.register('email')}
            />
            {emailForm.formState.errors.email && (
              <p className="text-sm text-error-500 mt-1">{emailForm.formState.errors.email.message}</p>
            )}
          </div>

          <button type="submit" disabled={isLoading} className="btn-primary w-full py-3">
            {isLoading ? (
              <svg className="animate-spin h-5 w-5 text-white mx-auto" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              'Send verification code'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
