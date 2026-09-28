import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button, Icon, Input, Screen, T } from '@/components/ui';
import { useAuth } from '@/providers/AuthProvider';
import { useI18n } from '@/providers/I18nProvider';
import { ApiError } from '@/services/api';
import { colors, radii, spacing } from '@/theme';

const CATEGORIES = ['FOOD', 'PUJA', 'CRAFT', 'TRANSPORT', 'GENERAL'];

export default function Register() {
  const { t, language } = useI18n();
  const { register } = useAuth();
  const router = useRouter();
  const [role, setRole] = useState<'PILGRIM' | 'VENDOR'>('PILGRIM');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [stall, setStall] = useState('');
  const [category, setCategory] = useState('FOOD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = name.trim().length >= 2 && phone.length === 10 && password.length >= 6 && (role === 'PILGRIM' || stall.trim().length >= 2);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const user = await register({ name: name.trim(), phone, password, role, language, stall: role === 'VENDOR' ? { name: stall.trim(), category } : undefined });
      router.replace(user.role === 'VENDOR' ? '/(vendor)/dashboard' : '/(pilgrim)/home');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('errGeneric'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen back title={t('register')} subtitle={t('registerSubtitle')} keyboard>
      <View style={styles.roles}>
        {(['PILGRIM', 'VENDOR'] as const).map((r) => {
          const active = role === r;
          return (
            <Pressable key={r} onPress={() => setRole(r)} style={[styles.role, active && styles.roleActive]}>
              <View style={[styles.roleIcon, active && { backgroundColor: colors.saffron }]}>
                <Icon name={r === 'PILGRIM' ? 'walk-outline' : 'storefront-outline'} size={22} color={active ? colors.onSaffron : colors.saffronDeep} />
              </View>
              <T variant="bodyStrong">{r === 'PILGRIM' ? t('iAmPilgrim') : t('iAmVendor')}</T>
              <T variant="caption">{r === 'PILGRIM' ? t('pilgrimDesc') : t('vendorDesc')}</T>
            </Pressable>
          );
        })}
      </View>

      <View style={{ gap: spacing.lg, marginTop: spacing.xxl }}>
        <Input label={t('name')} icon="person-outline" value={name} onChangeText={setName} placeholder="Arjun Sharma" autoCapitalize="words" />
        <Input label={t('phone')} icon="call-outline" keyboardType="number-pad" value={phone} onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))} placeholder="98765 43210" />
        <Input label={t('password')} icon="lock-closed-outline" secure value={password} onChangeText={setPassword} placeholder="min 6 characters" />
        {role === 'VENDOR' ? (
          <>
            <Input label={t('stallName')} icon="storefront-outline" value={stall} onChangeText={setStall} placeholder="Shankar Chai & Snacks" />
            <View>
              <T variant="label" style={{ marginBottom: spacing.sm }}>
                {t('stallCategory')}
              </T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {CATEGORIES.map((c) => (
                  <Pressable key={c} onPress={() => setCategory(c)} style={[styles.cat, category === c && styles.catActive]}>
                    <T variant="caption" weight="600" style={{ color: category === c ? colors.onSaffron : colors.inkSoft }}>
                      {c}
                    </T>
                  </Pressable>
                ))}
              </View>
            </View>
          </>
        ) : null}
        {error ? (
          <T variant="caption" tone="danger">
            {error}
          </T>
        ) : null}
        <Button title={t('register')} size="lg" fullWidth loading={busy} disabled={!valid} onPress={() => void submit()} iconRight="arrow-forward" />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  roles: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  role: { flex: 1, backgroundColor: colors.card, borderRadius: radii.lg, padding: spacing.md, borderWidth: 1.5, borderColor: colors.border, gap: spacing.xs },
  roleActive: { borderColor: colors.saffron, backgroundColor: colors.white },
  roleIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.saffronSoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  cat: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  catActive: { backgroundColor: colors.saffron, borderColor: colors.saffron },
});
