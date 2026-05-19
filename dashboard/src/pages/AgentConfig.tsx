import { useState, useEffect } from 'react';
import {
  Button, Form, Input, Select, Switch, Typography, message,
  Card, Divider, Spin,
} from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Business } from '../lib/types';

const { Title, Text } = Typography;
const { TextArea } = Input;

const MODEL_OPTIONS = [
  { value: 'google/gemini-2.5-flash-preview', label: 'Gemini 2.5 Flash (recomendado)' },
  { value: 'google/gemini-2.0-flash-lite-001', label: 'Gemini 2.0 Flash Lite (rápido)' },
  { value: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (gratuito)' },
  { value: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku' },
];

export default function AgentConfig() {
  const [selectedBiz, setSelectedBiz] = useState('');
  const [form] = Form.useForm();
  const qc = useQueryClient();

  const { data: businesses = [], isLoading: bizLoading } = useQuery({
    queryKey: ['businesses'],
    queryFn: api.getBusinesses,
  });

  const { data: agent, isLoading: agentLoading } = useQuery({
    queryKey: ['agent', selectedBiz],
    queryFn: () => api.getAgent(selectedBiz),
    enabled: !!selectedBiz,
  });

  useEffect(() => {
    if (agent) {
      form.setFieldsValue({
        assistantName: agent.assistantName,
        systemPrompt: agent.systemPrompt,
        model: agent.settings?.model,
        maxHistoryTokens: agent.settings?.maxHistoryTokens,
        searchMemory: agent.settings?.tools?.searchMemory,
      });
    }
  }, [agent, form]);

  const save = useMutation({
    mutationFn: (vals: Record<string, unknown>) => api.updateAgent(selectedBiz, {
      assistantName: vals.assistantName as string,
      systemPrompt: vals.systemPrompt as string,
      settings: {
        model: vals.model as string,
        maxHistoryTokens: Number(vals.maxHistoryTokens),
        tools: { searchMemory: Boolean(vals.searchMemory) },
      },
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['agent', selectedBiz] }); message.success('Configuração salva!'); },
    onError: (e: Error) => message.error(e.message),
  });

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Configuração do Agente</Title>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <Form.Item label="Negócio" style={{ marginBottom: 0 }}>
          <Select
            placeholder="Selecione um negócio para configurar"
            value={selectedBiz || undefined}
            onChange={v => setSelectedBiz(v)}
            loading={bizLoading}
            style={{ width: 300 }}
            options={(businesses as Business[]).map(b => ({ value: b._id, label: b.name }))}
          />
        </Form.Item>
      </Card>

      {selectedBiz && (
        agentLoading ? <Spin /> : (
          <Card>
            <Form form={form} layout="vertical" onFinish={vals => save.mutate(vals)}>
              <Divider orientation="left">Identidade</Divider>
              <Form.Item name="assistantName" label="Nome do assistente" rules={[{ required: true }]}>
                <Input placeholder="Assistente" style={{ maxWidth: 300 }} />
              </Form.Item>
              <Form.Item name="systemPrompt" label="System Prompt"
                extra={<Text type="secondary">Define a personalidade e regras do agente. Deixe vazio para o padrão.</Text>}>
                <TextArea
                  rows={6}
                  placeholder={`Você é um atendente especialista de WhatsApp para [nome da empresa].\nResponda sempre em português, de forma clara e objetiva.\n...`}
                />
              </Form.Item>

              <Divider orientation="left">Modelo e Limites</Divider>
              <Form.Item name="model" label="Modelo LLM">
                <Select options={MODEL_OPTIONS} style={{ maxWidth: 400 }} />
              </Form.Item>
              <Form.Item name="maxHistoryTokens" label="Limite da janela de contexto (tokens)"
                extra={<Text type="secondary">Padrão: 500.000 (50% de 1M). Acima disso, o histórico antigo é comprimido.</Text>}>
                <Input type="number" style={{ maxWidth: 200 }} />
              </Form.Item>

              <Divider orientation="left">Ferramentas</Divider>
              <Form.Item name="searchMemory" label="Busca na memória (Qdrant)" valuePropName="checked">
                <Switch />
              </Form.Item>

              <Form.Item>
                <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={save.isPending}>
                  Salvar configuração
                </Button>
              </Form.Item>
            </Form>
          </Card>
        )
      )}

      {!selectedBiz && !bizLoading && (
        <Text type="secondary">Selecione um negócio acima para configurar o agente.</Text>
      )}
    </>
  );
}
