import { Select, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { InstanceContact, WhatsAppGroup } from '../lib/types';

interface Props {
  businessId: string;
  instance: string;
  /** Filtra opções: 'group' = só grupos, 'contact' = só contatos, 'any' = ambos. */
  type: 'group' | 'contact' | 'any';
  value?: string;
  onChange?: (jid: string | undefined, opt: { isGroup: boolean; label: string } | null) => void;
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  allowClear?: boolean;
}

/**
 * Select unificado para JID do WhatsApp. Busca grupos e/ou contatos da instância
 * e exibe em grupos no dropdown (Grupos / Contatos), com ícones.
 */
export function JidSelect({
  businessId,
  instance,
  type,
  value,
  onChange,
  placeholder,
  disabled,
  style,
  allowClear,
}: Props) {
  const needsGroups = type === 'group' || type === 'any';
  const needsContacts = type === 'contact' || type === 'any';

  const groupsQ = useQuery({
    queryKey: ['instance-groups', businessId, instance],
    queryFn: () => api.getInstanceGroups(businessId, instance),
    enabled: needsGroups && !!businessId && !!instance,
    staleTime: 60_000,
  });

  const contactsQ = useQuery({
    queryKey: ['instance-contacts', businessId, instance],
    queryFn: () => api.getInstanceContacts(businessId, instance),
    enabled: needsContacts && !!businessId && !!instance,
    staleTime: 60_000,
  });

  const groups: WhatsAppGroup[] = groupsQ.data?.groups ?? [];
  const contacts: InstanceContact[] = contactsQ.data?.contacts ?? [];
  const loading = (needsGroups && groupsQ.isLoading) || (needsContacts && contactsQ.isLoading);

  const options: Array<{ label: string; options: Array<{ value: string; label: string; isGroup: boolean }> }> = [];
  if (needsGroups && groups.length) {
    options.push({
      label: '👥 Grupos',
      options: groups.map(g => ({
        value: g.id,
        label: `${g.subject}  ·  ${g.size}p`,
        isGroup: true,
      })),
    });
  }
  if (needsContacts && contacts.length) {
    options.push({
      label: '👤 Contatos',
      options: contacts.map(c => ({
        value: c.id,
        label: c.name || c.id,
        isGroup: false,
      })),
    });
  }

  return (
    <Select
      showSearch
      value={value || undefined}
      onChange={(v, opt) => {
        const o = Array.isArray(opt) ? opt[0] : opt;
        const isGroup = !!(o as { isGroup?: boolean })?.isGroup;
        const label = String((o as { label?: string })?.label ?? '');
        onChange?.(v as string | undefined, v ? { isGroup, label } : null);
      }}
      placeholder={placeholder ?? 'Selecione um JID...'}
      disabled={disabled || !instance}
      style={style}
      allowClear={allowClear}
      filterOption={(input, option) => {
        const label = String((option as { label?: string })?.label ?? '');
        const value = String((option as { value?: string })?.value ?? '');
        const i = input.toLowerCase();
        return label.toLowerCase().includes(i) || value.toLowerCase().includes(i);
      }}
      options={options}
      notFoundContent={loading ? <Spin size="small" /> : 'Nada encontrado'}
    />
  );
}
