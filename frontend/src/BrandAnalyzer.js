import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './BrandAnalyzer.css';

function BrandAnalyzer({ brand, onClose }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedStation, setExpandedStation] = useState(null);

  useEffect(() => {
    setLoading(true);
    axios.get(`http://localhost:8000/api/brand-analysis?brand=${brand}`)
      .then(res => {
        // 백엔드에서 받은 데이터를 노선별로 그룹화
        const grouped = res.data.reduce((acc, curr) => {
          if (!acc[curr.line]) acc[curr.line] = [];
          acc[curr.line].push(curr);
          return acc;
        }, {});
        setData(grouped);
        setLoading(false);
      })
      .catch(err => {
        console.error("브랜드 분석 데이터 로딩 실패:", err);
        setLoading(false);
      });
  }, [brand]);

  if (loading) return (
    <div className="brand-analyzer-overlay">
      <div className="analyzer-loading">☕ {brand} 입점 데이터를 분석하고 있습니다...</div>
    </div>
  );

  return (
    <div className="brand-analyzer-overlay">
      <div className="analyzer-content">
        <div className="analyzer-header">
          <h2><span>{brand}</span> 입점 역 탐색 (반경 500m)</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="analyzer-body">
          {Object.keys(data).length === 0 ? (
            <div className="no-data">해당 브랜드가 입점한 역 정보를 찾을 수 없습니다.</div>
          ) : (
            Object.entries(data).map(([line, stations]) => (
              <div key={line} className="line-section">
                <h4 className="line-title">{line}</h4>
                <div className="station-grid">
                  {stations.map(st => (
                    <div key={st.station_id} className="station-wrapper">
                      <button 
                        className={`analyzer-st-btn ${expandedStation === st.station_id ? 'active' : ''}`}
                        onClick={() => setExpandedStation(expandedStation === st.station_id ? null : st.station_id)}
                      >
                        {st.station_name} <small className="store-count">{st.stores.length}</small>
                      </button>
                      
                      {/* 역 버튼 클릭 시 매장 상세 리스트 팝업 */}
                      {expandedStation === st.station_id && (
                        <div className="store-list-popup">
                          <div className="popup-arrow"></div>
                          <ul className="store-list">
                            {st.stores.map((store, idx) => (
                              <li key={idx}>
                                <strong className="store-name">{store.name}</strong>
                                <p className="store-addr">{store.address}</p>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default BrandAnalyzer;