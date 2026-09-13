import { useEffect, useRef, type ReactNode } from 'react';
import { X, Bot, Camera, Wrench, ArrowUpRight, MapPin, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Equipment } from '../lib/types';
import { EQUIPMENT_LABELS, BOOKING_LABELS } from '../lib/domain';
export function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>
      <i />
      {EQUIPMENT_LABELS[status] ?? BOOKING_LABELS[status] ?? status}
    </span>
  );
}
export function EquipmentArt({
  equipment,
  large = false,
}: {
  equipment: Equipment;
  large?: boolean;
}) {
  const Icon =
    equipment.category === '机器人本体'
      ? Bot
      : equipment.category === '机器人传感器'
        ? Camera
        : Wrench;
  return (
    <div
      className={`equipment-art ${large ? 'large' : ''} art-${equipment.category === '机器人本体' ? 'robot' : equipment.category === '机器人传感器' ? 'sensor' : 'tool'}`}
    >
      {equipment.image_url ? (
        <img
          src={equipment.image_url}
          alt={equipment.name}
          onError={(e) => {
            e.currentTarget.hidden = true;
          }}
        />
      ) : (
        <>
          <div className="art-grid" />
          <Icon strokeWidth={1.05} size={large ? 98 : 76} />
          <span className="art-model">{equipment.model}</span>
        </>
      )}
      <span className="art-code">{equipment.asset_code}</span>
    </div>
  );
}
export function EquipmentCard({ equipment: e }: { equipment: Equipment }) {
  return (
    <article className="equipment-card">
      <Link className="art-link" to={`/equipment/${e.id}`} aria-label={`查看${e.name}`}>
        <EquipmentArt equipment={e} />
        <div className="card-badge">
          <Badge status={e.status} />
        </div>
      </Link>
      <div className="equipment-card-body">
        <div className="eyebrow">
          {e.category} <span>· {e.project}</span>
        </div>
        <Link to={`/equipment/${e.id}`} className="equipment-name">
          {e.name}
        </Link>
        <p className="model">{e.model}</p>
        <div className="card-meta">
          <span>
            <MapPin size={14} />
            {e.room} 实验室
          </span>
          <span>
            <UserRound size={14} />
            {e.manager_name}
          </span>
        </div>
        <Link className="card-action" to={`/equipment/${e.id}`}>
          查看详情与预约
          <ArrowUpRight size={17} />
        </Link>
      </div>
    </article>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="关闭弹窗" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-symbol">—</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
