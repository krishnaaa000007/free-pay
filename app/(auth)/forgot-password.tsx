import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Input, Screen, T } from '@/components/ui';
import { useI18n } from '@/providers/I18nProvider';
import { ApiError, post } from '@/services/api';
import { toast } from '@/services/notifications';
import { spacing } from '@/theme';

/** Two-step recovery. The POC uses a fixed demo OTP (123456) returned by the server in dev. */
export default function ForgotPassword() {
  const { t } = useI18n();
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demoOtp, setDemoOtp] = useState<string | undefined>();

  const sendOtp = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ ok: boolean; demo_otp?: string }>('/api/auth/forgot-password', { phone }, { auth: false });
      setDemoOtp(r.demo_otp);
      setStep(2);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('errGeneric'));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      await post('/api/auth/reset-password', { phone, otp, password }, { auth: false });
      toast.success(t('resetPassword'), t('done'));
      router.replace('/(auth)/login');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('errGeneric'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen back title={t('resetPassword')} keyboard>
      <View style={{ gap: spacing.lg, marginTop: spacing.lg }}>
        {step === 1 ? (
          <>
            <Input label={t('phone')} icon="call-outline" keyboardType="number-pad" value={phone} onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))} error={error} />
            <Button title={t('sendOtp')} fullWidth size="lg" loading={busy} disabled={phone.length !== 10} onPress={() => void sendOtp()} />
          </>
        ) : (
          <>
            <Card tone="info" elevated={false}>
              <T variant="body">{t('otpSentHint')}</T>
              {demoOtp ? (
                <T variant="mono" style={{ marginTop: spacing.xs }}>
                  demo OTP: {demoOtp}
                </T>
              ) : null}
            </Card>
            <Input label={t('otp')} icon="keypad-outline" keyboardType="number-pad" value={otp} onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))} maxLength={6} />
            <Input label={t('newPassword')} icon="lock-closed-outline" secure value={password} onChangeText={setPassword} error={error} />
            <Button title={t('resetPassword')} fullWidth size="lg" loading={busy} disabled={otp.length !== 6 || password.length < 6} onPress={() => void reset()} />
          </>
        )}
      </View>
    </Screen>
  );
}
