/**
 * WhatsApp — conectar o número do WhatsApp e gerenciar notificações de escalada.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Typography, Card, Button, Modal, Spin, Result, Badge, message,
  Input, Space, Tag, Alert, Tooltip,
} from 'antd';
import {
  WhatsAppOutlined, WifiOutlined, DisconnectOutlined, LinkOutlined,
  CopyOutlined, BellOutlined, PlusOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusiness } from '../lib/BusinessContext';
import { api } from '../lib/api';

const { Title, Text, Paragraph } = Typography;

interface InstanceStatus { instanceName: string; status: string; inboxId: number | null; }

function statusBadge(status: string): { color: 'success' | 'warning' | 'default'; label: string } {
  if (status === 'open') return { color: 'success', label: 'Conectado' };
  if (status === 'connecting') return { color: 'warning', label: 'Conectando…' };
  return { color: 'default', label: 'Desconectado' };
}

export default function Whatsapp() {
  const { business, refetch } = useBusiness();
  const qc = useQueryClient();

  // ─── Status das instâncias (a LT geralmente tem 1) ─────────────────────
  const [statuses, setStatuses] = useState<InstanceStatus[]>([]);
  const [loadingStatus, setLoadingStatus] = useState(true);

  const fetchStatuses = useCallback(async () => {
    try {
      const data = await api.getInstancesStatus(business._id);
      setStatuses(data);
    } catch { /* ignore */ }
    finally { setLoadingStatus(false); }
  }, [business._id]);

  useEffect(() => {
    setLoadingStatus(true);
    fetchStatuses();
    const id = setInterval(fetchStatuses, 10_000);
    return () => clearInterval(id);
  }, [fetchStatuses]);

  // ─── Desconectar ───────────────────────────────────────────────────────
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const disconnect = async (instanceName: string) => {
    setDisconnecting(instanceName);
    try {
      await api.disconnectInstance(business._id, instanceName);
      message.success('WhatsApp desconectado');
      fetchStatuses();
    } catch (e) { message.error((e as Error).message); }
    finally { setDisconnecting(null); }
  };

  // ─── QR Code modal ─────────────────────────────────────────────────────
  const [qrOpen, setQrOpen] = useState(false);
  const [qrInstance, setQrInstance] = useState<string | null>(null);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrConnected, setQrConnected] = useState(false);
  const qrRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrStatusRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchQr = async (instanceName: string) => {
    setQrLoading(true); setQrBase64(null);
    try {
      const d = await api.getBusinessQr(business._id, instanceName);
      setQrBase64(d.base64);
    } catch { /* ignore */ }
    setQrLoading(false);
  };

  const openQr = (instanceName: string) => {
    setQrInstance(instanceName);
    setQrConnected(false);
    setQrBase64(null);
    setQrOpen(true);
    fetchQr(instanceName);
    if (qrStatusRef.current) clearInterval(qrStatusRef.current);
    if (qrRefreshRef.current) clearInterval(qrRefreshRef.current);
    qrStatusRef.current = setInterval(async () => {
      try {
        const d = await api.getBusinessQrStatus(business._id, instanceName);
        if (d.status === 'open') {
          setQrConnected(true);
          if (qrStatusRef.current) clearInterval(qrStatusRef.current);
          if (qrRefreshRef.current) clearInterval(qrRefreshRef.current);
          setTimeout(() => { fetchStatuses(); refetch(); }, 1500);
        }
      } catch { /* ignore */ }
    }, 5000);
    qrRefreshRef.current = setInterval(() => fetchQr(instanceName), 30_000);
  };

  const closeQr = () => {
    setQrOpen(false);
    if (qrStatusRef.current) clearInterval(qrStatusRef.current);
    if (qrRefreshRef.current) clearInterval(qrRefreshRef.current);
    fetchStatuses();
  };

  useEffect(() => () => {
    if (qrStatusRef.current) clearInterval(qrStatusRef.current);
    if (qrRefreshRef.current) clearInterval(qrRefreshRef.current);
  }, []);

  // ─── Link de conexão remota ────────────────────────────────────────────
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkInstance, setLinkInstance] = useState<string | null>(null);
  const [linkEmail, setLinkEmail] = useState('');
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);

  const generateLink = async () => {
    if (!linkInstance) return;
    setLinkLoading(true);
    try {
      const { connectUrl } = await api.sendQrLink(business._id, linkInstance, linkEmail || undefined);
      setLinkUrl(connectUrl);
      if (linkEmail) message.success('Link enviado por email!');
    } catch (e) { message.error((e as Error).message); }
    finally { setLinkLoading(false); }
  };

  // ─── Lista de notificações ─────────────────────────────────────────────
  const { data: notifyData, isLoading: loadingNotify } = useQuery({
    queryKey: ['notify-list', business._id],
    queryFn: () => api.getNotifyList(business._id),
  });
  const notifyList = notifyData?.escalationNotifyList ?? [];
  const [newPhone, setNewPhone] = useState('');
  const [addingPhone, setAddingPhone] = useState(false);

  const addPhone = async () => {
    const digits = newPhone.replace(/\D/g, '');
    if (!digits) return;
    setAddingPhone(true);
    try {
      await api.addNotifyContact(business._id, digits);
      qc.invalidateQueries({ queryKey: ['notify-list', business._id] });
      setNewPhone('');
      message.success('Número adicionado');
    } catch (e) { message.error((e as Error).message); }
    finally { setAddingPhone(false); }
  };

  const removePhone = async (phone: string) => {
    try {
      await api.removeNotifyContact(business._id, phone);
      qc.invalidateQueries({ queryKey: ['notify-list', business._id] });
      message.success('Número removido');
    } catch (e) { message.error((e as Error).message); }
  };

  // ─── Render ────────────────────────────────────────────────────────────
  const rows: InstanceStatus[] = statuses.length > 0
    ? statuses
    : (business.instances ?? []).map(name => ({
        instanceName: name,
        status: 'unknown',
        inboxId: (business.instanceInboxes ?? {})[name] ?? null,
      }));

  return (
    <div>
      <Title level={3} style={{ marginTop: 0 }}>
        <WhatsAppOutlined /> WhatsApp
      </Title>
      <Paragraph type="secondary">
        Conecte o número de WhatsApp que o atendente virtual vai usar para conversar com seus clientes.
      </Paragraph>

      <Card
        title={<span><WhatsAppOutlined /> Número conectado</span>}
        extra={
          <Tooltip title="Atualizar status">
            <Button size="small" icon={<ReloadOutlined />} onClick={fetchStatuses} loading={loadingStatus} />
          </Tooltip>
        }
        style={{ marginBottom: 16 }}
      >
        {!business.instances?.length ? (
          <Alert
            type="warning"
            showIcon
            message="Nenhum número configurado"
            description="Entre em contato com o suporte para criar o seu número de WhatsApp."
          />
        ) : loadingStatus && statuses.length === 0 ? (
          <Spin />
        ) : (
          rows.map(inst => {
            const sb = statusBadge(inst.status);
            return (
              <div
                key={inst.instanceName}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #f5f5f5', flexWrap: 'wrap' }}
              >
                <Badge status={sb.color} text={<Text strong>{sb.label}</Text>} />
                <Text type="secondary" code style={{ fontSize: 12 }}>{inst.instanceName}</Text>
                <div style={{ marginLeft: 'auto' }}>
                  <Space>
                    {inst.status !== 'open' && (
                      <>
                        <Button type="primary" icon={<WifiOutlined />} onClick={() => openQr(inst.instanceName)}>
                          Conectar (QR Code)
                        </Button>
                        <Button icon={<LinkOutlined />} onClick={() => {
                          setLinkInstance(inst.instanceName); setLinkEmail(''); setLinkUrl(null); setLinkOpen(true);
                        }}>
                          Enviar link
                        </Button>
                      </>
                    )}
                    {inst.status === 'open' && (
                      <Button
                        danger
                        ghost
                        icon={<DisconnectOutlined />}
                        loading={disconnecting === inst.instanceName}
                        onClick={() => disconnect(inst.instanceName)}
                      >
                        Desconectar
                      </Button>
                    )}
                  </Space>
                </div>
              </div>
            );
          })
        )}
      </Card>

      <Card title={<span><BellOutlined /> Notificações no WhatsApp</span>}>
        <Paragraph type="secondary" style={{ marginBottom: 12 }}>
          Quando o atendente virtual precisar passar a conversa para um humano, estes números recebem um aviso no WhatsApp.
        </Paragraph>
        {loadingNotify ? (
          <Spin />
        ) : (
          <>
            {notifyList.length === 0 ? (
              <Text type="secondary" italic>Nenhum número cadastrado.</Text>
            ) : (
              <Space wrap style={{ marginBottom: 12 }}>
                {notifyList.map(phone => (
                  <Tag
                    key={phone}
                    closable
                    onClose={() => removePhone(phone)}
                    style={{ fontSize: 13, padding: '4px 10px' }}
                  >
                    +{phone}
                  </Tag>
                ))}
              </Space>
            )}
            <Space.Compact style={{ width: '100%', maxWidth: 380, marginTop: 8 }}>
              <Input
                placeholder="Ex: 351912345678 (com DDI, sem espaços)"
                value={newPhone}
                onChange={e => setNewPhone(e.target.value)}
                onPressEnter={addPhone}
              />
              <Button type="primary" icon={<PlusOutlined />} loading={addingPhone} onClick={addPhone}>
                Adicionar
              </Button>
            </Space.Compact>
          </>
        )}
      </Card>

      {/* Modal QR */}
      <Modal
        title={`Conectar WhatsApp${qrInstance ? ` — ${qrInstance}` : ''}`}
        open={qrOpen}
        onCancel={closeQr}
        footer={qrConnected ? null : [
          <Button key="refresh" loading={qrLoading} onClick={() => qrInstance && fetchQr(qrInstance)}>
            Atualizar QR
          </Button>,
          <Button key="close" onClick={closeQr}>Fechar</Button>,
        ]}
        width={400}
      >
        {qrConnected ? (
          <Result status="success" title="WhatsApp conectado!" />
        ) : (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div
              style={{
                width: 280, height: 280, margin: '0 auto 16px', background: '#f9f9f9',
                borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '2px solid #f0f0f0',
              }}
            >
              {qrLoading ? <Spin size="large" /> : qrBase64 ? (
                <img src={qrBase64} alt="QR Code" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 10 }} />
              ) : (
                <Text type="secondary">QR indisponível</Text>
              )}
            </div>
            <Paragraph type="secondary" style={{ fontSize: 13 }}>
              No celular, abra o <Text strong>WhatsApp → Dispositivos conectados → Conectar dispositivo</Text> e escaneie o código acima.
            </Paragraph>
          </div>
        )}
      </Modal>

      {/* Modal link */}
      <Modal
        title="Link de conexão remota"
        open={linkOpen}
        onCancel={() => setLinkOpen(false)}
        footer={null}
        width={460}
      >
        <Paragraph type="secondary" style={{ fontSize: 13 }}>
          Gere um link seguro (válido por 24h) para conectar o WhatsApp de outro dispositivo, ou envie por email para alguém da equipe escanear.
        </Paragraph>
        {linkUrl && (
          <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
            <Input value={linkUrl} readOnly />
            <Button
              icon={<CopyOutlined />}
              onClick={() => { navigator.clipboard.writeText(linkUrl); message.success('Copiado!'); }}
            >
              Copiar
            </Button>
          </Space.Compact>
        )}
        <Input
          placeholder="Email (opcional)"
          value={linkEmail}
          onChange={e => setLinkEmail(e.target.value)}
          style={{ marginBottom: 12 }}
        />
        <Button type="primary" loading={linkLoading} onClick={generateLink} block>
          {linkUrl ? 'Gerar novo link' : 'Gerar link'}
        </Button>
      </Modal>
    </div>
  );
}
