'use client';
import {
  Controller,
  useFormContext,
  type FieldValues,
  type Path,
} from 'react-hook-form';
import { Field } from './input';

interface FormFieldProps<T extends FieldValues> {
  name: Path<T>;
  label: string;
  hint?: string;
  required?: boolean;
  children: (field: {
    value: any;
    onChange: (v: any) => void;
    onBlur: () => void;
  }) => React.ReactNode;
}

export function FormField<T extends FieldValues>({
  name,
  label,
  hint,
  required,
  children,
}: FormFieldProps<T>) {
  const {
    control,
    formState: { errors },
  } = useFormContext<T>();
  const error = (errors as any)?.[name]?.message as string | undefined;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Field label={label} hint={hint} required={required} error={error}>
          {children(field)}
        </Field>
      )}
    />
  );
}
