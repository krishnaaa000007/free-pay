import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { colors } from '../../theme';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** Ionicons wrapper with our default ink colour. */
export function Icon({ name, size = 20, color = colors.ink }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color} />;
}
