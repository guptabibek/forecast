import { Navigate } from 'react-router-dom';

// Token-based reset flow replaced by OTP flow in ForgotPassword page
export default function ResetPassword() {
  return <Navigate to="/forgot-password" replace />;
}
