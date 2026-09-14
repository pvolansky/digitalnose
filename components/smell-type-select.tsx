'use client';
import { smellTypes } from '@/lib/domain/reports';
import { SelectField } from './select-field';
const options = [
  { value: '', label: 'No type selected' },
  ...smellTypes.map((value) => ({ value, label: value })),
];
export function SmellTypeSelect(props: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return <SelectField {...props} name="smell_type" options={options} placeholder="Choose a type" />;
}
