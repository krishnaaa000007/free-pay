import { Link, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { LanguagePicker } from '@/components/LanguagePicker';
import { Button, Card, Icon, Input, Screen, T } from '@/components/ui';
import { useAuth } from '@/providers/AuthProvider';
import { useI18n } from '@/providers/I18nProvider';
import { useNetwork } from '@/providers/NetworkProvider';
import { ApiError } from '@/services/api';
import { colors, radii, spacing } from '@/theme';

const DEMO = {
  pilgrim: { phone: '9000000001', password: 'free1234', name: 'Arjun Sharma' },
  vendor: { phone: '9000000002', password: 'free1234', name: 'Shankar Chai & Snacks' },
};

export default function Login() {
  const { t } = useI18n();
  const { login } = useAuth();
  const { isOnline } = useNetwork();
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (p = phone, pw = password) => {
    setError(null);
    setBusy(true);
    try {
      const user = await login(p, pw);
      router.replace(user.role === 'VENDOR' ? '/(vendor)/dashboard' : '/(pilgrim)/home');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError(t('errInvalidLogin'));
      else if (err instanceof ApiError && err.isNetwork) setError(t('errNetwork'));
      else setError((err as Error).message || t('errGeneric'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen keyboard>
      <View style={{ marginTop: spacing.xl }}>
        <View style={styles.logo}>
          <Icon name="leaf" size={26} color={colors.onSaffron} />
        </View>
        <T variant="hero" style={{ marginTop: spacing.lg }}>
          {t('welcomeBack')}
        </T>
        <T variant="body" style={{ marginTop: spacing.xs }}>
          {t('loginSubtitle')}
        </T>
      </View>

      <View style={{ gap: spacing.lg, marginTop: spacing.xxxl }}>
        <Input label={t('phone')} icon="call-outline" keyboardType="number-pad" value={phone} onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))} placeholder="98765 43210" maxLength={10} autoComplete="tel" />
        <Input label={t('password')} icon="lock-closed-outline" secure value={password} onChangeText={setPassword} placeholder="••••••••" error={error} onSubmitEditing={() => void submit()} returnKeyType="go" />
        <View style={{ alignItems: 'flex-end', marginTop: -spacing.sm }}>
          <Link href="/(auth)/forgot-password" asChild>
            <Pressable hitSlop={8}>
              <T variant="caption" tone="saffron" weight="600">
                {t('forgotPassword')}
              </T>
            </Pressable>
          </Link>
        </View>
        <Button title={t('login')} size="lg" fullWidth loading={busy} disabled={phone.length !== 10 || password.length < 4} onPress={() => void submit()} iconRight="arrow-forward" />
        {!isOnline ? (
          <T variant="caption" tone="warning" align="center">
            {t('networkOffline')} — {t('errNetwork')}
          </T>
        ) : null}
      </View>

      <Card tone="alt" style={{ marginTop: spacing.xxxl }} elevated={false}>
        <T variant="label">{t('demoAccounts')}</T>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
          <DemoTile icon="person-outline" label={t('demoPilgrim')} name={DEMO.pilgrim.name} onPress={() => void submit(DEMO.pilgrim.phone, DEMO.pilgrim.password)} />
          <DemoTile icon="storefront-outline" label={t('demoVendor')} name={DEMO.vendor.name} onPress={() => void submit(DEMO.vendor.phone, DEMO.vendor.password)} />
        </View>
      </Card>

      <View style={{ marginTop: spacing.xxl, alignItems: 'center', gap: spacing.md }}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <T variant="body">{t('noAccount')}</T>
          <Link href="/(auth)/register" asChild>
            <Pressable hitSlop={8}>
              <T variant="bodyStrong" tone="saffron">
                {t('register')}
              </T>
            </Pressable>
          </Link>
        </View>
        <LanguagePicker compact />
      </View>
    </Screen>
  );
}

function DemoTile({ icon, label, name, onPress }: { icon: 'person-outline' | 'storefront-outline'; label: string; name: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.demoTile, pressed && { backgroundColor: colors.saffronSoft }]}>
      <Icon name={icon} size={20} color={colors.saffronDeep} />
      <T variant="bodyStrong" style={{ marginTop: spacing.xs }}>
        {label}
      </T>
      <T variant="caption" numberOfLines={1}>
        {name}
      </T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  logo: { width: 52, height: 52, borderRadius: 16, backgroundColor: colors.saffron, alignItems: 'center', justifyContent: 'center' },
  demoTile: { flex: 1, backgroundColor: colors.card, borderRadius: radii.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
});
