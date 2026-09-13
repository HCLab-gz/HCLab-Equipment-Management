import {
  ArrowRight,
  ArrowUpRight,
  Box,
  CalendarClock,
  Clock3,
  ShieldCheck,
  MapPin,
  BookOpen,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApp } from '../lib/store';
import { accessState, cnDate, dateKey } from '../lib/domain';
import { Badge, EquipmentCard, Empty } from '../components/ui';
export function Dashboard() {
  const { data, user } = useApp(),
    today = dateKey(),
    pending = data.bookings.filter((b) => b.status === 'pending').length,
    active = data.bookings.filter((b) => b.status === 'approved' || b.status === 'in_use'),
    available = data.equipment.filter((e) => e.status === 'available').length;
  const items = data.bookings
    .filter((b) => ['pending', 'approved', 'in_use'].includes(b.status))
    .slice(0, 4);
  return (
    <div className="dashboard">
      <div className="page-heading">
        <div>
          <div className="eyebrow">实验室工作台</div>
          <h1>
            {user ? `${user.name}，欢迎回来` : '每一次实验，从有序预约开始'}
            <span className="heading-dot">.</span>
          </h1>
          <p>设备、时间与协作，在这里井然有序。</p>
        </div>
        <span className="date-chip">
          <CalendarClock size={16} />
          {today.replaceAll('-', ' / ')}
          <i />
          北京时间
        </span>
      </div>
      <section className="welcome-panel">
        <div>
          <span className="welcome-tag">
            <i />
            HCLAB · 共享实验室
          </span>
          <h2>
            好设备，一起用。
            <br />
            好研究，一起做。
          </h2>
          <p>
            查看 504 / 505 实验室设备，选择时间，
            <br className="desktop-break" />
            让下一次实验从容开始。
          </p>
          <Link className="button" to="/equipment">
            预约仪器
            <ArrowUpRight size={18} />
          </Link>
          <Link className="welcome-secondary" to="/rules">
            阅读实验室条例
            <ArrowRight size={15} />
          </Link>
        </div>
        <div className="room-map">
          <div className="map-caption">
            <span>我们的实验空间</span>
            <span>02 / LABS</span>
          </div>
          {(['504', '505'] as const).map((room, i) => (
            <Link to={`/equipment?room=${room}`} className={`room-tile room-${room}`} key={room}>
              <span className="room-number">
                {room}
                <ArrowUpRight size={20} />
              </span>
              <span className="room-description">
                {i === 0 ? '机器人与操作实验区' : '机器人与电子工具区'}
              </span>
              <span className="room-count">
                <i />
                {data.equipment.filter((e) => e.room === room).length} 台设备 <span>查看设备</span>
              </span>
            </Link>
          ))}
          <span className="map-foot">
            <MapPin size={12} />
            使用后请归还至设备指定位置
          </span>
        </div>
      </section>
      <section className="stats-grid">
        {[
          [Box, '已录入设备', data.equipment.length, '台', '两间实验室统一管理'],
          [ShieldCheck, '可预约设备', available, '台', '按开放时间提交申请'],
          [
            CalendarClock,
            user?.role === 'admin' ? '待处理申请' : '我的待审批',
            pending,
            '项',
            '批准后方可开始使用',
          ],
          [Clock3, '已批准 / 使用中', active.length, '项', '记得按时归还设备'],
        ].map(([Icon, title, value, unit, desc]) => {
          const I = Icon as typeof Box;
          return (
            <article className="stat" key={String(title)}>
              <div>
                <span>{String(title)}</span>
                <I size={18} />
              </div>
              <strong>
                {String(value)}
                <small>{String(unit)}</small>
              </strong>
              <p>{String(desc)}</p>
            </article>
          );
        })}
      </section>
      <div className="dashboard-columns">
        <section className="panel">
          <div className="section-heading">
            <h2>
              我的预约<span className="subtle-count">{items.length}</span>
            </h2>
            <Link to="/records">
              查看全部
              <ArrowRight size={15} />
            </Link>
          </div>
          {!user ? (
            <Empty title="登录后查看你的预约">
              <Link to="/login">登录账号</Link>，开始安排下一次实验。
            </Empty>
          ) : items.length === 0 ? (
            <Empty title="暂时没有进行中的预约">
              <Link to="/equipment">去看看实验室的设备</Link>
            </Empty>
          ) : (
            <div className="booking-summary">
              {items.map((b) => {
                const eq = data.equipment.find((e) => e.id === b.equipment_id);
                return (
                  <Link to="/records" key={b.id} className="booking-summary-row">
                    <div className="mini-equipment">
                      <Box size={21} />
                    </div>
                    <div>
                      <strong>{eq?.name ?? '设备'}</strong>
                      <small>
                        {cnDate(b.starts_at)} — {cnDate(b.ends_at).split(' ')[1]} · {eq?.room}{' '}
                        实验室
                      </small>
                    </div>
                    <Badge status={b.status} />
                  </Link>
                );
              })}
            </div>
          )}
        </section>
        <section className="safety-card">
          <span className="eyebrow">
            <ShieldCheck size={15} /> 安全先行
          </span>
          <h2>离开前，多确认一步。</h2>
          <p>
            电池入防爆箱，工具归位，设备断电。
            <br />
            最后离开的同学，请确认电磁门锁死。
          </p>
          <Link to="/rules">
            查看完整实验室条例
            <ArrowUpRight size={17} />
          </Link>
          <div className="safety-status">
            <span className="shield-bubble">
              <BookOpen size={17} />
            </span>
            <span>
              {user
                ? accessState(user)
                  ? '你的平台准入状态正常'
                  : '你的平台准入权限已停用'
                : '新成员须阅读条例并通过准入考试'}
              <small>{user ? '按预约批准时段使用设备' : '随机 10 道单选题 · 80 分合格'}</small>
            </span>
          </div>
        </section>
      </div>
      <section className="featured">
        <div className="section-heading">
          <div>
            <h2>探索实验室设备</h2>
            <p>从机器人到传感器，找到实验需要的下一件设备。</p>
          </div>
          <Link to="/equipment">
            全部设备
            <ArrowRight size={16} />
          </Link>
        </div>
        <div className="equipment-grid">
          {data.equipment.slice(0, 3).map((e) => (
            <EquipmentCard key={e.id} equipment={e} />
          ))}
        </div>
      </section>
    </div>
  );
}
