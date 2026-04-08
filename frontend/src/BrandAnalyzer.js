import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './BrandAnalyzer.css';
import { lineColors } from './constants'; // 노선 색상 데이터 임포트

function BrandAnalyzer({ brand, mode, onClose }) {
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [expandedStation, setExpandedStation] = useState(null);
  const [expandedLines, setExpandedLines] = useState(new Set());

  useEffect(() => {
    setLoading(true);
    axios.get(`http://localhost:8000/api/brand-analysis?brand=${brand}`)
      .then(res => {
        const sorted = res.data.sort((a, b) => {
          if (a.line !== b.line) return a.line.localeCompare(b.line);
          return parseInt(a.station_id) - parseInt(b.station_id);
        });
        const grouped = sorted.reduce((acc, curr) => {
          if (!acc[curr.line]) acc[curr.line] = [];
          acc[curr.line].push(curr);
          return acc;
        }, {});
        setData(grouped);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, [brand]);

  const toggleLine = (lineName) => {
    const newExpanded = new Set(expandedLines);
    if (newExpanded.has(lineName)) {
      newExpanded.delete(lineName);
    } else {
      newExpanded.add(lineName);
    }
    setExpandedLines(newExpanded);
  };

  if (loading) return (
    <div className={`analyzer-container mode-${mode}`}>
      <div className="analyzer-loading">☕ {brand} 데이터를 분석하고 있습니다...</div>
    </div>
  );

  return (
    <div className={`analyzer-container mode-${mode}`}>
      <div className="analyzer-header">
        <h2><span>{brand}</span> 입점 역 탐색</h2>
        <button className="close-btn" onClick={onClose}>
          <span className="icon">✕</span> 지도 돌아가기
        </button>
      </div>

      <div className="analyzer-body">
        {Object.entries(data).map(([line, stations]) => (
          <div key={line} className="line-section-block">
            <button 
              className={`line-toggle-btn ${expandedLines.has(line) ? 'open' : ''}`} 
              onClick={() => toggleLine(line)}
              // 인라인 스타일로 고유 노선 색상 적용
              style={{ borderLeftColor: lineColors[line] || '#10B981' }}
            >
              <span className="line-name">{line}</span>
              <span className="line-info">{stations.length}개 역 입점 {expandedLines.has(line) ? '▲' : '▼'}</span>
            </button>

            {expandedLines.has(line) && (
              <div className="station-3-grid animate-fade">
                {stations.map(st => (
                  <div key={st.station_id} className="st-wrapper">
                    <button 
                      className={`st-btn ${expandedStation === st.station_id ? 'active' : ''}`}
                      onClick={() => setExpandedStation(expandedStation === st.station_id ? null : st.station_id)}
                    >
                      <span className="name">{st.station_name}</span>
                      <span className="count">{st.stores.length}</span>
                    </button>
                    
                    {expandedStation === st.station_id && (
                      <div className="st-popover">
                        {st.stores.map((store, idx) => (
                          <div key={idx} className="popover-item">
                            <div className="p-name">{store.name}</div>
                            <div className="p-addr">{store.address}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default BrandAnalyzer;