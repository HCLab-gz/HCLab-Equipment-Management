import { useRef, useState } from 'react';
import { ChevronDown, List, ShieldCheck, TriangleAlert } from 'lucide-react';
import {
  equipmentChapters,
  ruleChapters,
  RULES_VERSION,
  rulesUpdated,
  sourceNote,
} from '../data/rules';

const chapters = [...ruleChapters, ...equipmentChapters];

export function RulesReader() {
  const [opened, setOpened] = useState(() => new Set(ruleChapters.map((section) => section.id)));
  const [active, setActive] = useState(chapters[0].id);
  const sections = useRef(new Map<string, HTMLDetailsElement>());

  function jump(id: string) {
    setActive(id);
    setOpened((previous) => new Set(previous).add(id));
    // Let React open the target before positioning it. Do not change the hash router URL.
    requestAnimationFrame(() => {
      const section = sections.current.get(id);
      section?.scrollIntoView({ behavior: 'auto', block: 'start' });
      section?.querySelector('summary')?.focus({ preventScroll: true });
    });
  }

  return (
    <div className="rules-reader">
      <div className="rules-intro">
        <div className="rules-intro-copy">
          <span className="eyebrow">
            <ShieldCheck size={15} /> 504 / 505 实验室
          </span>
          <h2>先了解约定，再开始实验。</h2>
          <p>通用规定适用于所有成员；使用机器人前，还需阅读对应设备须知并完成专项培训。</p>
          <div className="rules-meta">
            <span>更新于 {rulesUpdated}</span>
            <span>{chapters.length} 个章节</span>
            <span>版本 {RULES_VERSION}</span>
          </div>
        </div>
        <div className="rules-essentials" aria-label="三项基本约定">
          <div>
            <span>01</span>
            <p>
              <strong>先批准，再使用</strong>只在获批时段内使用，续约需另行审批。
            </p>
          </div>
          <div>
            <span>02</span>
            <p>
              <strong>用完归位，登记归还</strong>工具和设备回到指定位置，方便下一位同学。
            </p>
          </div>
          <div>
            <span>03</span>
            <p>
              <strong>离开前，确认安全</strong>检查电源与电池，确认两扇门均已锁闭。
            </p>
          </div>
        </div>
      </div>
      <div className="rules-layout">
        <nav className="rules-directory" aria-label="管理条例章节目录">
          <div className="rules-directory-title">
            <List size={16} /> 阅读目录
          </div>
          <p>点击章节定位，可单独展开或收起。</p>
          {(
            [
              ['所有成员必读', ruleChapters],
              ['设备专项须知', equipmentChapters],
            ] as const
          ).map(([title, list]) => (
            <div className="rules-directory-group" key={title}>
              <h3>{title}</h3>
              {list.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  className={active === section.id ? 'active' : ''}
                  aria-current={active === section.id ? 'location' : undefined}
                  aria-controls={`rule-${section.id}`}
                  onClick={() => jump(section.id)}
                >
                  <span>{String(chapters.indexOf(section) + 1).padStart(2, '0')}</span>
                  {section.title}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="rules-chapters">
          <div className="rules-reader-toolbar">
            <span>
              条例正文 <small>通用规定默认展开</small>
            </span>
            <div>
              <button type="button" onClick={() => setOpened(new Set(chapters.map((s) => s.id)))}>
                全部展开
              </button>
              <button type="button" onClick={() => setOpened(new Set())}>
                全部收起
              </button>
            </div>
          </div>
          {chapters.map((section, index) => (
            <details
              className={`rule-chapter ${section.audience}`}
              id={`rule-${section.id}`}
              key={section.id}
              open={opened.has(section.id)}
              ref={(element) => {
                if (element) sections.current.set(section.id, element);
                else sections.current.delete(section.id);
              }}
              onToggle={(event) => {
                const isOpen = event.currentTarget.open;
                setOpened((previous) => {
                  if (previous.has(section.id) === isOpen) return previous;
                  const next = new Set(previous);
                  if (isOpen) next.add(section.id);
                  else next.delete(section.id);
                  return next;
                });
              }}
            >
              <summary onClick={() => setActive(section.id)}>
                <span className="rule-number">{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <span className="rule-audience">
                    {section.audience === 'general' ? '通用规定' : '设备专项'}
                  </span>
                  <h3>{section.title}</h3>
                  <p>{section.summary}</p>
                </div>
                <ChevronDown className="rule-chevron" size={19} />
              </summary>
              <div className="rule-chapter-body">
                {section.warning && (
                  <div className="rule-warning">
                    <TriangleAlert size={17} />
                    <p>{section.warning}</p>
                  </div>
                )}
                {section.groups.map((group, groupIndex) => (
                  <section className="rule-topic" key={group.title || groupIndex}>
                    {group.title && <h4>{group.title}</h4>}
                    <ol>
                      {group.items.map((item, itemIndex) => {
                        const separator = item.indexOf('：');
                        const hasLabel = separator > 0 && separator <= 16;
                        return (
                          <li key={itemIndex}>
                            {hasLabel ? (
                              <>
                                <strong>{item.slice(0, separator)}：</strong>
                                {item.slice(separator + 1)}
                              </>
                            ) : (
                              item
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                ))}
              </div>
            </details>
          ))}
          <p className="rules-source-note">{sourceNote}</p>
        </div>
      </div>
    </div>
  );
}
