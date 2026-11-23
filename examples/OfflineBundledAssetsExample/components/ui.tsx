// Small shadcn-style building blocks for the examples: the same colors, radius and
// spacing as KittenML's web app, light and dark, with no UI library. Every example
// has its own copy of this file, so each one stays self-contained.
import { useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const LIGHT = {
  background: '#fafaf9',
  foreground: '#0a0a0a',
  card: '#ffffff',
  primary: '#171717',
  primaryForeground: '#fafafa',
  muted: '#f5f5f5',
  mutedForeground: '#737373',
  border: '#e5e5e5',
  ring: '#a3a3a3',
  destructive: '#dc2626',
  success: '#16a34a',
  overlay: 'rgba(0,0,0,0.4)',
};

const DARK: typeof LIGHT = {
  background: '#202126',
  foreground: '#f4f4f5',
  card: '#25262c',
  primary: '#eeeeef',
  primaryForeground: '#202126',
  muted: '#2c2d33',
  mutedForeground: '#a7a8ad',
  border: 'rgba(255,255,255,0.11)',
  ring: '#85868d',
  destructive: '#f87171',
  success: '#4ade80',
  overlay: 'rgba(0,0,0,0.6)',
};

export type Theme = typeof LIGHT;

const SHEETS = { light: makeStyles(LIGHT), dark: makeStyles(DARK) };

/** The current colors and styles, following the system's light or dark mode. */
export function useUI() {
  const dark = useColorScheme() === 'dark';
  return { t: dark ? DARK : LIGHT, s: dark ? SHEETS.dark : SHEETS.light, dark };
}

// ---- Layout -------------------------------------------------------------------------

/** The page: KittenML logo and name on top, a title, then the content. */
export function Screen({
  title,
  description,
  badge,
  children,
}: {
  title: string;
  description: string;
  badge?: string;
  children: ReactNode;
}) {
  const { s, dark } = useUI();
  return (
    <SafeAreaView style={s.screen}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <View style={s.topBar}>
        <View style={s.brand}>
          <Image source={require('../assets/kittenml.png')} style={s.logo} accessibilityLabel="KittenML" />
          <Text style={s.brandName}>KittenTTS</Text>
        </View>
        {badge ? <Badge>{badge}</Badge> : null}
      </View>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.page}>
          <View style={s.heading}>
            <Text style={s.title}>{title}</Text>
            <Text style={s.description}>{description}</Text>
          </View>
          {children}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ title, description, children }: { title?: string; description?: string; children: ReactNode }) {
  const { s } = useUI();
  return (
    <View style={s.card}>
      {title ? (
        <View style={s.cardHeader}>
          <Text style={s.cardTitle}>{title}</Text>
          {description ? <Text style={s.cardDescription}>{description}</Text> : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Field({ label, hint, children, style }: { label: string; hint?: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { s } = useUI();
  return (
    <View style={[s.field, style]}>
      <Text style={s.label}>{label}</Text>
      {children}
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Row({ children }: { children: ReactNode }) {
  const { s } = useUI();
  return <View style={s.row}>{children}</View>;
}

// ---- Controls -----------------------------------------------------------------------

type ButtonVariant = 'default' | 'outline' | 'ghost';

export function Button({
  title,
  onPress,
  variant = 'default',
  icon,
  loading = false,
  disabled = false,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: 'play' | 'stop';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { t, s } = useUI();
  const color = variant === 'default' ? t.primaryForeground : t.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        variant === 'default' && s.buttonDefault,
        variant === 'outline' && s.buttonOutline,
        pressed && s.pressed,
        (disabled || loading) && s.disabled,
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={color} /> : icon === 'play' ? <PlayIcon color={color} /> : icon === 'stop' ? <StopIcon color={color} /> : null}
      <Text style={[s.buttonText, { color }]}>{title}</Text>
    </Pressable>
  );
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

export interface SelectGroup<T extends string> {
  title?: string;
  options: SelectOption<T>[];
}

/** A select like shadcn's: a field that opens a sheet with the options, grouped. */
export function Select<T extends string>({
  value,
  groups,
  onChange,
  disabled = false,
  title,
  placeholder = 'Select',
}: {
  value: T | null;
  groups: SelectGroup<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Shown at the top of the sheet. */
  title: string;
  placeholder?: string;
}) {
  const { t, s } = useUI();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const all = groups.flatMap(g => g.options);
  const selected = all.find(o => o.value === value);
  // Long lists, such as the cloud voices, get a search box.
  const searchable = all.length > 12;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map(g => ({ ...g, options: g.options.filter(o => `${o.label} ${o.description ?? ''}`.toLowerCase().includes(q)) }))
      .filter(g => g.options.length > 0);
  }, [groups, query]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${selected?.label ?? placeholder}`}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [s.selectTrigger, pressed && s.pressed, disabled && s.disabled]}
      >
        <Text style={[s.selectValue, !selected && { color: t.mutedForeground }]} numberOfLines={1}>
          {selected?.label ?? placeholder}
        </Text>
        <ChevronIcon color={t.mutedForeground} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={s.overlay} onPress={close} accessibilityLabel="Close">
          <Pressable style={s.sheet} onPress={() => {}}>
            <Text style={s.sheetTitle}>{title}</Text>
            {searchable ? (
              <Input value={query} onChangeText={setQuery} placeholder="Search" autoCorrect={false} autoCapitalize="none" />
            ) : null}
            <ScrollView style={s.sheetList} keyboardShouldPersistTaps="handled">
              {shown.map((group, i) => (
                <View key={group.title ?? i} style={s.sheetGroup}>
                  {group.title ? <Text style={s.sheetGroupTitle}>{group.title}</Text> : null}
                  {group.options.map(option => {
                    const active = option.value === value;
                    return (
                      <Pressable
                        key={option.value}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        onPress={() => {
                          close();
                          onChange(option.value);
                        }}
                        style={({ pressed }) => [s.sheetItem, (pressed || active) && { backgroundColor: t.muted }]}
                      >
                        <View style={s.sheetItemText}>
                          <Text style={s.sheetItemLabel}>{option.label}</Text>
                          {option.description ? <Text style={s.sheetItemDescription}>{option.description}</Text> : null}
                        </View>
                        {active ? <CheckIcon color={t.foreground} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
              {shown.length === 0 ? <Text style={s.hint}>Nothing matches.</Text> : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

/** A row of choices in a muted track, like shadcn's tabs. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled = false,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const { s } = useUI();
  return (
    <View style={[s.segmented, disabled && s.disabled]}>
      {options.map(option => {
        const active = option.value === value;
        return (
          <Pressable
            key={String(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={[s.segment, active && s.segmentActive]}
          >
            <Text style={[s.segmentText, active && s.segmentTextActive]} numberOfLines={1}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Input(props: TextInputProps) {
  const { t, s } = useUI();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={t.mutedForeground}
      {...props}
      onFocus={e => { setFocused(true); props.onFocus?.(e); }}
      onBlur={e => { setFocused(false); props.onBlur?.(e); }}
      style={[s.input, focused && s.inputFocused, props.editable === false && s.disabled, props.style]}
    />
  );
}

export function TextArea(props: TextInputProps) {
  const { s } = useUI();
  return <Input multiline textAlignVertical="top" {...props} style={[s.textArea, props.style]} />;
}

// ---- Feedback -----------------------------------------------------------------------

export function Badge({ children, tone = 'outline' }: { children: ReactNode; tone?: 'outline' | 'success' }) {
  const { t, s } = useUI();
  return (
    <View style={s.badge}>
      {tone === 'success' ? <View style={[s.dot, { backgroundColor: t.success }]} /> : null}
      <Text style={s.badgeText}>{children}</Text>
    </View>
  );
}

/** One line of status under a control: a spinner, a progress bar, an error or a note. */
export function Status({
  kind,
  text,
  progress,
}: {
  kind: 'loading' | 'ready' | 'error' | 'note';
  text: string;
  progress?: number;
}) {
  const { t, s } = useUI();
  if (kind === 'error') {
    return (
      <View style={s.alert}>
        <Text style={s.alertText}>{text}</Text>
      </View>
    );
  }
  return (
    <View style={s.status}>
      <View style={s.statusLine}>
        {kind === 'loading' ? <ActivityIndicator size="small" color={t.mutedForeground} /> : null}
        {kind === 'ready' ? <View style={[s.dot, { backgroundColor: t.success }]} /> : null}
        <Text style={s.statusText}>{text}</Text>
      </View>
      {progress !== undefined ? (
        <View style={s.progressTrack}>
          <View style={[s.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
      ) : null}
    </View>
  );
}

export function Stats({ items }: { items: { label: string; value: string }[] }) {
  const { s } = useUI();
  return (
    <View style={s.stats}>
      {items.map(item => (
        <View key={item.label} style={s.stat}>
          <Text style={s.statLabel}>{item.label}</Text>
          <Text style={s.statValue}>{item.value}</Text>
        </View>
      ))}
    </View>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  const { s } = useUI();
  return <Text style={s.hint}>{children}</Text>;
}

// ---- Icons, drawn with views ---------------------------------------------------------

function ChevronIcon({ color }: { color: string }) {
  return <View style={[iconStyles.chevron, { borderColor: color }]} />;
}

function CheckIcon({ color }: { color: string }) {
  return <View style={[iconStyles.check, { borderColor: color }]} />;
}

function PlayIcon({ color }: { color: string }) {
  return <View style={[iconStyles.play, { borderLeftColor: color }]} />;
}

function StopIcon({ color }: { color: string }) {
  return <View style={[iconStyles.stop, { backgroundColor: color }]} />;
}

const iconStyles = StyleSheet.create({
  chevron: {
    width: 7,
    height: 7,
    borderRightWidth: 1.5,
    borderBottomWidth: 1.5,
    transform: [{ rotate: '45deg' }],
    marginTop: -4,
    marginRight: 2,
  },
  check: {
    width: 6,
    height: 11,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    transform: [{ rotate: '45deg' }],
    marginTop: -3,
    marginRight: 4,
  },
  play: {
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderTopWidth: 5.5,
    borderBottomWidth: 5.5,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  stop: { width: 9, height: 9, borderRadius: 1.5 },
});

// ---- Styles -------------------------------------------------------------------------

function makeStyles(t: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.background },
    topBar: {
      height: 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.border,
      backgroundColor: t.background,
    },
    brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    logo: { width: 28, height: 28 },
    brandName: { color: t.foreground, fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
    content: { padding: 20, paddingBottom: 48 },
    page: { width: '100%', maxWidth: 560, alignSelf: 'center', gap: 16 },
    heading: { gap: 6, marginBottom: 4 },
    title: { color: t.foreground, fontSize: 26, fontWeight: '600', letterSpacing: -0.5 },
    description: { color: t.mutedForeground, fontSize: 15, lineHeight: 21 },
    card: {
      backgroundColor: t.card,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 12,
      padding: 16,
      gap: 16,
    },
    cardHeader: { gap: 4 },
    cardTitle: { color: t.foreground, fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
    cardDescription: { color: t.mutedForeground, fontSize: 13, lineHeight: 18 },
    field: { gap: 8 },
    label: { color: t.foreground, fontSize: 14, fontWeight: '500' },
    hint: { color: t.mutedForeground, fontSize: 13, lineHeight: 18 },
    row: { flexDirection: 'row', gap: 12 },
    button: {
      flex: 1,
      height: 42,
      borderRadius: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingHorizontal: 16,
    },
    buttonDefault: { backgroundColor: t.primary },
    buttonOutline: { backgroundColor: t.card, borderWidth: 1, borderColor: t.border },
    buttonText: { fontSize: 14, fontWeight: '500' },
    pressed: { opacity: 0.8 },
    disabled: { opacity: 0.5 },
    selectTrigger: {
      height: 42,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      backgroundColor: t.card,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    selectValue: { color: t.foreground, fontSize: 14, flexShrink: 1 },
    overlay: { flex: 1, backgroundColor: t.overlay, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: t.card,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      borderWidth: 1,
      borderColor: t.border,
      padding: 16,
      paddingBottom: 32,
      gap: 12,
      maxHeight: '75%',
      width: '100%',
      maxWidth: 560,
      alignSelf: 'center',
    },
    sheetTitle: { color: t.foreground, fontSize: 16, fontWeight: '600' },
    sheetList: { flexGrow: 0 },
    sheetGroup: { marginBottom: 8 },
    sheetGroupTitle: { color: t.mutedForeground, fontSize: 12, fontWeight: '500', paddingHorizontal: 8, paddingVertical: 6 },
    sheetItem: { flexDirection: 'row', alignItems: 'center', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 10 },
    sheetItemText: { flex: 1, gap: 2 },
    sheetItemLabel: { color: t.foreground, fontSize: 14 },
    sheetItemDescription: { color: t.mutedForeground, fontSize: 12 },
    segmented: { flexDirection: 'row', backgroundColor: t.muted, borderRadius: 8, padding: 3 },
    segment: { flex: 1, height: 32, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
    segmentActive: {
      backgroundColor: t.card,
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 2,
      shadowOffset: { width: 0, height: 1 },
      elevation: 1,
    },
    segmentText: { color: t.mutedForeground, fontSize: 13, fontWeight: '500' },
    segmentTextActive: { color: t.foreground },
    input: {
      minHeight: 42,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: t.card,
      color: t.foreground,
      fontSize: 14,
    },
    inputFocused: { borderColor: t.ring },
    textArea: { minHeight: 104, fontSize: 15, lineHeight: 22 },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 3,
    },
    badgeText: { color: t.foreground, fontSize: 12, fontWeight: '500' },
    dot: { width: 7, height: 7, borderRadius: 4 },
    status: { gap: 8 },
    statusLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    statusText: { color: t.mutedForeground, fontSize: 13, flexShrink: 1 },
    progressTrack: { height: 6, borderRadius: 3, backgroundColor: t.muted, overflow: 'hidden' },
    progressFill: { height: 6, borderRadius: 3, backgroundColor: t.primary },
    alert: {
      borderWidth: 1,
      borderColor: t.destructive,
      borderRadius: 8,
      padding: 12,
    },
    alertText: { color: t.destructive, fontSize: 13, lineHeight: 19 },
    stats: { flexDirection: 'row', gap: 12 },
    stat: { flex: 1, gap: 4 },
    statLabel: { color: t.mutedForeground, fontSize: 12 },
    statValue: { color: t.foreground, fontSize: 18, fontWeight: '600', letterSpacing: -0.3, fontVariant: ['tabular-nums'] },
  });
}
