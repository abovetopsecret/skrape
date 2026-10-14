import React from 'react';
import { Box, Text, useInput } from 'ink';
import { ACCENT } from './theme.js';

export interface SelectItem<T> {
  label: string;
  value: T;
  /** Dim text shown after the label. */
  hint?: string;
}

interface SelectListProps<T> {
  items: Array<SelectItem<T>>;
  onSelect: (value: T) => void;
}

/** Minimal arrow-key list, built directly on Ink's useInput rather than pulling
 *  in a select-input dependency. Cheap to render: a handful of Text lines,
 *  re-rendered only on cursor movement or selection. */
export function SelectList<T>({ items, onSelect }: SelectListProps<T>): React.JSX.Element {
  const [cursor, setCursor] = React.useState(0);

  useInput((input, key) => {
    if (items.length === 0) return;
    if (key.upArrow || input === 'k') {
      setCursor((current) => (current - 1 + items.length) % items.length);
    } else if (key.downArrow || input === 'j') {
      setCursor((current) => (current + 1) % items.length);
    } else if (key.return) {
      const item = items[cursor];
      if (item) onSelect(item.value);
    }
  });

  const labelWidth = Math.max(...items.map((item) => item.label.length));
  return (
    <Box flexDirection="column">
      {items.map((item, index) => {
        const active = index === cursor;
        return (
          <Text key={item.label}>
            <Text color={ACCENT}>{active ? '❯ ' : '  '}</Text>
            <Text color={active ? ACCENT : undefined} bold={active}>
              {item.hint ? item.label.padEnd(labelWidth) : item.label}
            </Text>
            {item.hint && <Text dimColor>   {item.hint}</Text>}
          </Text>
        );
      })}
      <Text dimColor>{'\n'}↑↓ move · enter select</Text>
    </Box>
  );
}
