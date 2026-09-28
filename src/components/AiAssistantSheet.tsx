import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLedgerStats } from '../hooks/useLedger';
import { useAuth } from '../providers/AuthProvider';
import { useI18n } from '../providers/I18nProvider';
import { useNetwork } from '../providers/NetworkProvider';
import { askAssistant, type ChatMessage } from '../services/ai';
import { colors, fonts, radii, shadows, spacing } from '../theme';
import { Icon, IconButton, Pill, T } from './ui';

/**
 * Bottom-sheet chat with the Free Pay assistant. Online it goes through the server's OpenAI
 * proxy; offline it answers from the built-in FAQ so help is always one tap away.
 */
export function AiAssistantSheet({ visible, onClose, screen }: { visible: boolean; onClose: () => void; screen?: string }) {
  const { t, language } = useI18n();
  const { user } = useAuth();
  const { isOnline } = useNetwork();
  const { stats } = useLedgerStats('IN');
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<'server' | 'offline' | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (visible) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  }, [visible, messages.length]);

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || busy) return;
      const next: ChatMessage[] = [...messages, { role: 'user', content: q }];
      setMessages(next);
      setInput('');
      setBusy(true);
      try {
        const r = await askAssistant(next, { role: user?.role, screen, language, pending_sync: stats.pendingCount, online: isOnline });
        setSource(r.source);
        setMessages([...next, { role: 'assistant', content: r.reply }]);
      } finally {
        setBusy(false);
      }
    },
    [busy, messages, user?.role, screen, language, stats.pendingCount, isOnline],
  );

  const suggestions = [t('aiSuggest1'), t('aiSuggest2'), t('aiSuggest3'), t('aiSuggest4')];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap} pointerEvents="box-none">
        <View style={[styles.sheet, shadows.float, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.avatar}>
              <Icon name="sparkles" size={18} color={colors.onSaffron} />
            </View>
            <View style={{ flex: 1 }}>
              <T variant="heading">{t('aiTitle')}</T>
              <T variant="caption">{!isOnline || source === 'offline' ? t('aiOfflineHint') : 'gpt-4o-mini · Free Pay proxy'}</T>
            </View>
            <IconButton icon="close" onPress={onClose} tone="ghost" label={t('close')} />
          </View>

          <ScrollView ref={scrollRef} style={styles.body} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }} keyboardShouldPersistTaps="handled">
            {messages.length === 0 ? (
              <View style={{ gap: spacing.sm }}>
                <T variant="body">
                  {t('namaste')}! {t('aiPlaceholder')}
                </T>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                  {suggestions.map((s) => (
                    <Pressable key={s} onPress={() => void send(s)}>
                      <Pill label={s} tone="saffron" />
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
            {messages.map((m, i) => (
              <View key={i} style={[styles.bubble, m.role === 'user' ? styles.bubbleUser : styles.bubbleBot]}>
                <T variant="body" style={{ color: m.role === 'user' ? colors.onSaffron : colors.ink }}>
                  {m.content}
                </T>
              </View>
            ))}
            {busy ? (
              <View style={[styles.bubble, styles.bubbleBot]}>
                <T variant="caption">{t('aiThinking')}</T>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.inputRow}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={t('aiPlaceholder')}
              placeholderTextColor={colors.faint}
              style={styles.input}
              onSubmitEditing={() => void send(input)}
              returnKeyType="send"
            />
            <IconButton icon="arrow-up" tone="saffron" onPress={() => void send(input)} label="Send" />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.overlay },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.parchment, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, maxHeight: '82%' },
  handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.saffron, alignItems: 'center', justifyContent: 'center' },
  body: { maxHeight: 380, marginTop: spacing.md },
  bubble: { padding: spacing.md, borderRadius: radii.lg, maxWidth: '88%' },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: colors.saffron, borderBottomRightRadius: 6 },
  bubbleBot: { alignSelf: 'flex-start', backgroundColor: colors.card, borderBottomLeftRadius: 6, borderWidth: 1, borderColor: colors.hairline },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  input: { flex: 1, backgroundColor: colors.card, borderRadius: radii.pill, paddingHorizontal: spacing.lg, height: 46, fontFamily: fonts.body, fontSize: 15, color: colors.ink, borderWidth: 1, borderColor: colors.border },
});
