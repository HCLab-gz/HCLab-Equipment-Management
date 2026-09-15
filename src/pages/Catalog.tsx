import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal, RotateCcw, LayoutGrid, List } from 'lucide-react';
import { useApp } from '../lib/store';
import { EquipmentCard, Empty } from '../components/ui';
export function Catalog() {
  const { data } = useApp(),
    [params, setParams] = useSearchParams(),
    [search, setSearch] = useState(''),
    [category, setCategory] = useState(''),
    [project, setProject] = useState(''),
    [location, setLocation] = useState(''),
    [available, setAvailable] = useState(false),
    [compact, setCompact] = useState(false);
  const room = params.get('room') ?? '',
    categories = [...new Set(data.equipment.map((e) => e.category))],
    projects = [...new Set(data.equipment.map((e) => e.project))],
    locations = [
      ...new Set(
        data.equipment
          .filter((e) => !room || e.room === room)
          .map((e) => `${e.room} · ${e.location}`),
      ),
    ];
  const filtered = data.equipment.filter(
    (e) =>
      (!category || e.category === category) &&
      (!project || e.project === project) &&
      (!room || e.room === room) &&
      (!location || `${e.room} · ${e.location}` === location) &&
      (!available || e.status === 'available') &&
      search
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .every((s) =>
          `${e.name} ${e.model} ${e.asset_code} ${e.manager_name} ${e.room} ${e.location}`
            .toLowerCase()
            .includes(s),
        ),
  );
  const reset = () => {
    setParams({});
    setCategory('');
    setProject('');
    setLocation('');
    setSearch('');
    setAvailable(false);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">共享设备目录</div>
          <h1>
            仪器预约<span className="heading-dot">.</span>
          </h1>
          <p>按项目、地点和分类查找设备，选择适合你的实验时段。</p>
        </div>
        <span className="catalog-count">
          <strong>{data.equipment.length}</strong> 台设备 / 2 间实验室
        </span>
      </div>
      <div className="catalog-layout">
        <aside className="filter-panel">
          <div className="filter-title">
            <span>
              <SlidersHorizontal size={16} />
              筛选设备
            </span>
            <button aria-label="重置全部筛选" onClick={reset}>
              <RotateCcw size={15} />
            </button>
          </div>
          <fieldset>
            <legend>设备分类</legend>
            {['', ...categories].map((c) => (
              <label
                className={category === c ? 'filter-option selected' : 'filter-option'}
                key={c}
              >
                <input
                  type="radio"
                  name="category"
                  checked={category === c}
                  onChange={() => setCategory(c)}
                />
                <span>{c || '全部设备'}</span>
                <small>{data.equipment.filter((e) => !c || e.category === c).length}</small>
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>放置地点</legend>
            <div className="room-switch">
              {['', '504', '505'].map((r) => (
                <button
                  className={room === r ? 'selected' : ''}
                  key={r}
                  onClick={() => {
                    setParams(r ? { room: r } : {});
                    setLocation('');
                  }}
                >
                  {r || '全部'}
                </button>
              ))}
            </div>
            <select
              aria-label="具体存放位置"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            >
              <option value="">全部具体位置</option>
              {locations.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </fieldset>
          <fieldset>
            <legend>项目归属</legend>
            {['', ...projects].map((p) => (
              <label className="filter-option" key={p}>
                <input
                  type="radio"
                  name="project"
                  checked={project === p}
                  onChange={() => setProject(p)}
                />
                <span>{p || '全部项目'}</span>
              </label>
            ))}
          </fieldset>
          <div className="filter-tip">
            找不到需要的设备？
            <br />
            请联系管理员录入设备信息。
          </div>
        </aside>
        <div className="catalog-main">
          <div className="catalog-toolbar">
            <label className="search-input">
              <Search size={18} />
              <input
                placeholder="搜索仪器名称、型号、编号或负责人…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={available}
                onChange={(e) => setAvailable(e.target.checked)}
              />
              仅看可预约
            </label>
          </div>
          <div className="catalog-result-row">
            <span>
              找到 <strong>{filtered.length}</strong> 台设备{' '}
              {category && <b className="filter-tag">{category}</b>}
            </span>
            <div className="view-toggle">
              <button
                className={!compact ? 'selected' : ''}
                aria-label="卡片视图"
                onClick={() => setCompact(false)}
              >
                <LayoutGrid size={16} />
              </button>
              <button
                className={compact ? 'selected' : ''}
                aria-label="紧凑视图"
                onClick={() => setCompact(true)}
              >
                <List size={17} />
              </button>
            </div>
          </div>
          {filtered.length ? (
            <div className={`equipment-grid ${compact ? 'compact-grid' : ''}`}>
              {filtered.map((e) => (
                <EquipmentCard equipment={e} key={e.id} />
              ))}
            </div>
          ) : (
            <Empty title="没有符合条件的设备">
              <button className="text-button" onClick={reset}>
                清除筛选条件
              </button>
            </Empty>
          )}
        </div>
      </div>
    </>
  );
}
