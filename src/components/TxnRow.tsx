import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatINR } from '../domain/money';
import { formatTime, relativeTime } from '../domain/time';
import type { LedgerTransaction, ServerTransaction, TxnMode } from '../domain/types';
import { colors, radii, spacing } from '../theme';
import { Icon, StatusPill, T, type IconName } from './ui';

const modeIcon: Record<TxnMode, IconName> = { OFFLINE: 'cloud-offline-outline', ONLINE: 'flash-outline', NGO_CREDIT: 'heart-outline' };
const categoryIcon: Record<string, IconName> = { FOOD: 'restaurant-outline', PUJA: 'flower-outline', CRAFT: 'color-palette-outline', TRANSPORT: 'boat-outline', GENERAL: 'storefront-outline' };

export type AnyTxn =
  | (LedgerTransaction & { kind?: 'ledger' })
  | (ServerTransaction & { kind: 'server'; direction: 'IN' | 'OUT' });

/** One transaction in a list. Works for both local ledger rows and server rows. */
export function TxnRow({ txn, showTime = 'relative', last, category, onPress }: { txn: AnyTxn; showTime?: 'relative' | 'clock'; last?: boolean; category?: string; onPress?: () => void }) {
  const router = useRouter();
  const isIn = txn.direction === 'IN';
  const title = isIn ? ('payer_name' in txn && txn.payer_name) || (txn.mode === 'NGO_CREDIT' ? txn.memo ?? 'NGO credit' : 'Pilgrim') : txn.merchant_name;
  const subtitleParts = [showTime === 'relative' ? relativeTime(txn.created_at) : formatTime(txn.created_at), txn.mode === 'OFFLINE' ? 'Offline' : txn.mode === 'ONLINE' ? 'Online' : 'NGO credit'];
  if (txn.memo && txn.mode !== 'NGO_CREDIT') subtitleParts.push(txn.memo);
  const review = 'fraud_decision' in txn ? txn.fraud_decision === 'REVIEW' : (txn.fraud_flags?.length ?? 0) > 0;
  const icon: IconName = isIn ? modeIcon[txn.mode] : categoryIcon[category ?? 'GENERAL'] ?? 'storefront-outline';

  return (
    <Pressable
      onPress={onPress ?? (() => router.push({ pathname: '/transaction/[id]', params: { id: txn.id } }))}
      style={({ pressed }) => [styles.row, !last && styles.divider, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.icon, { backgroundColor: isIn ? colors.successSoft : colors.saffronSoft }]}>
        <Icon name={icon} size={20} color={isIn ? colors.success : colors.saffronDeep} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <T variant="bodyStrong" numberOfLines={1}>
          {title}
        </T>
        <T variant="caption" numberOfLines={1}>
          {subtitleParts.join(' · ')}
        </T>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <T variant="bodyStrong" style={{ color: isIn ? colors.success : colors.ink }}>
          {isIn ? '+' : '−'}
          {formatINR(txn.amount)}
        </T>
        <StatusPill status={txn.status} size="sm" review={review} />
      </View>
      <Icon name="chevron-forward" size={16} color={colors.faint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.hairline },
  icon: { width: 42, height: 42, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
});
