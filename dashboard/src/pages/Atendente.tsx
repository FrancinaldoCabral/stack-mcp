/**
 * Atendente virtual — configuração simples do agente IA principal do negócio.
 * Esconde modelo/tokens em "Avançado". Sem jargão técnico.
 */
import { useEffect, useState } from 'react';
import {
  Typography, Card, Form, Input, Button, message, Collapse, AutoComplete, Alert, Spin,
} from 'antd';
import { RobotOutlined, SaveOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useBusiness } from '../lib/BusinessContext';
import { api } from '../lib/api';
import type { Agent } from '../lib/types';

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

  // Pega o agente principal (primeiro). Se não houver, vamos criar ao salvar.
  const agent: Agent | undefined = business.agents?.[0];

  useEffect(() => {
    form.setFieldsValue({
      assistantName: agent?.assistantName ?? 'Vendly',
      systemPrompt: agent?.systemPrompt ?? DEFAULT_PROMPT,
      model: agent?.model ?? 'google/gemini-2.5-flash-lite',
    });
  }, [agent, form]);

  const save = useMutation({
    mutationFn: async (vals: { assistantName: string; systemPrompt: string; model: string }) => {
      const payload = {
        name: 'Atendente principal',
        assistantName: vals.assistantName,
        systemPrompt: vals.systemPrompt,
        model: vals.model,
      };
      if (agent) {
        return api.updateAgent(business._id, agent._id, payload);
      }
      return api.createAgent(business._id, payload);
    },
    onSuccess: () => {
      message.success('Atendente salvo!');
      qc.invalidateQueries({ queryKey: ['businesses'] });
      refetch();
    },
    onError: (e: Error) => message.error(e.message),
  });

  return (
    <div>
      <Title level={3} style={{ marginTop: 0 }}>
        <RobotOutlined /> Atendente virtual
      </Title>
      <Paragraph type="secondary">
        Configure como o atendente automático conversa com seus clientes no WhatsApp.
      </Paragraph>

      {!agent && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Nenhum atendente configurado ainda"
          description="Preencha o nome e as instruções abaixo e clique em Salvar para criar o atendente."
        />
      )}

      <Card>
        <Form form={form} layout="vertical" onFinish={(vals) => save.mutate(vals)}>
          <Form.Item
            name="assistantName"
            label="Nome do atendente"
            tooltip="Como o atendente vai se apresentar nas mensagens"
            rules={[{ required: true, message: 'Dê um nome ao seu atendente' }]}
          >
            <Input placeholder="Ex: Sofia, Carol, Bot da LT" />
          </Form.Item>

          <Form.Item
            name="systemPrompt"
            label="Instruções do atendente"
            tooltip="Descreva como ele deve se comportar, o que pode ajudar e o tom de voz"
            rules={[{ required: true, message: 'Escreva as instruções do atendente' }]}
          >
            <Input.TextArea
              rows={14}
              placeholder="Escreva como o atendente deve agir..."
              style={{ fontFamily: 'inherit' }}
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
                  help="Padrão recomendado: Gemini 2.5 Flash Lite. Só mude se souber o que está fazendo."
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
              Salvar atendente
            </Button>
          </div>
        </Form>
      </Card>

      {save.isPending && <Spin />}
    </div>
  );
}
