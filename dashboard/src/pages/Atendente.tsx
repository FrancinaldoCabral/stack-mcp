/**
 * Atendente virtual — salva systemPrompt/model/assistantName diretamente no
 * documento do business (campos raiz), que é o que o workflow N8N lê.
 * O sistema de agentes (business.agents[]) não é lido pelo workflow atual.
 */
import { useEffect } from 'react';
import {
  Typography, Card, Form, Input, Button, message, Collapse, AutoComplete, Alert,
} from 'antd';
import { RobotOutlined, SaveOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useBusiness } from '../lib/BusinessContext';
import { api } from '../lib/api';
import type { Business } from '../lib/types';

const { Title, Text, Paragraph } = Typography;

const POPULAR_MODELS = [
  { value: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite (rápido e barato)' },
  { value: 'google/gemini-2.5-flash',      label: 'Gemini 2.5 Flash (equilibrado)' },
  { value: 'google/gemini-2.0-flash-001',  label: 'Gemini 2.0 Flash' },
  { value: 'openai/gpt-4.1-mini',          label: 'GPT 4.1 mini' },
  { value: 'openai/gpt-4o-mini',           label: 'GPT 4o mini' },
  { value: 'anthropic/claude-3.5-haiku',   label: 'Claude 3.5 Haiku' },
];

const DEFAULT_PROMPT = `Você é a assistente virtual da LivraisonTotale, empresa de entregas.

## Como atender
- Responda de forma curta, simpática e direta (1 a 2 frases por mensagem).
- Use linguagem natural de WhatsApp.
- Trate o cliente pelo nome quando souber.
- Nunca invente informação. Se não souber, diga que vai verificar.

## O que ajudo
- Pedidos de entrega (restaurantes parceiros)
- Status do pedido em andamento
- Dúvidas sobre prazos e taxas`;

export default function Atendente() {
  const { business, refetch } = useBusiness();
  const qc = useQueryClient();
  const [form] = Form.useForm();

  useEffect(() => {
    form.setFieldsValue({
      assistantName: (business as Business & { assistantName?: string }).assistantName ?? '',
      systemPrompt: business.systemPrompt ?? DEFAULT_PROMPT,
      model: business.settings?.model ?? 'google/gemini-2.5-flash-lite',
    });
  }, [business._id, form]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: async (vals: { assistantName: string; systemPrompt: string; model: string }) => {
      return api.updateBusiness(business._id, {
        assistantName: vals.assistantName,
        systemPrompt: vals.systemPrompt,
        settings: { ...(business.settings ?? {}), model: vals.model },
      } as Partial<Business>);
    },
    onSuccess: () => {
      message.success('Atendente salvo!');
      qc.invalidateQueries({ queryKey: ['businesses'] });
      refetch();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const hasPrompt = !!business.systemPrompt;

  return (
    <div>
      <Title level={3} style={{ marginTop: 0 }}>
        <RobotOutlined /> Atendente virtual
      </Title>
      <Paragraph type="secondary">
        Configure como o atendente automático conversa com seus clientes no WhatsApp.
        Esta configuração aplica-se a conversas individuais. Para grupos (restaurante/entregadores),
        use as <strong>Personas</strong> na aba Delivery.
      </Paragraph>

      {!hasPrompt && (
        <Alert
          type="info"
          icon={<InfoCircleOutlined />}
          showIcon
          style={{ marginBottom: 16 }}
          message="Prompt padrão em uso"
          description="Nenhum prompt customizado configurado. O atendente está usando o prompt padrão do sistema. Edite abaixo para personalizar."
        />
      )}

      <Card>
        <Form form={form} layout="vertical" onFinish={(vals) => save.mutate(vals)}>
          <Form.Item
            name="assistantName"
            label="Nome do atendente"
            tooltip="Nome pelo qual o atendente se apresenta nas conversas individuais"
            rules={[{ required: true, message: 'Dê um nome ao seu atendente' }]}
          >
            <Input placeholder="Ex: Carol, Sofia, Assistente LT" />
          </Form.Item>

          <Form.Item
            name="systemPrompt"
            label="Instruções do atendente (System Prompt)"
            tooltip="Define o comportamento, tom e capacidades do atendente nas conversas individuais"
            rules={[{ required: true, message: 'Escreva as instruções do atendente' }]}
          >
            <Input.TextArea
              rows={14}
              placeholder="Escreva como o atendente deve agir..."
              style={{ fontFamily: 'monospace', fontSize: 13 }}
            />
          </Form.Item>

          <Collapse
            ghost
            items={[{
              key: 'adv',
              label: <Text type="secondary">⚙️ Configurações avançadas</Text>,
              children: (
                <Form.Item
                  name="model"
                  label="Modelo de inteligência artificial"
                  help="Padrão recomendado: Gemini 2.5 Flash Lite. Afeta conversas individuais e de grupo."
                >
                  <AutoComplete
                    options={POPULAR_MODELS}
                    placeholder="google/gemini-2.5-flash-lite"
                    filterOption={(input, option) =>
                      (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                  />
                </Form.Item>
              ),
            }]}
          />

          <div style={{ textAlign: 'right', marginTop: 16 }}>
            <Button
              type="primary"
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={save.isPending}
            >
              Salvar
            </Button>
          </div>
        </Form>
      </Card>
    </div>
  );
}
