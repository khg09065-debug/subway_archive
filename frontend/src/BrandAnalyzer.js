import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './BrandAnalyzer.css';
import { lineColors } from './constants';

function BrandAnalyzer({ brand, mode, onClose }) {
    const [data, setData] = useState({});
    const [loading, setLoading] = useState(true);
    const [expandedStation, setExpandedStation] = useState(null);
    const [expandedLines, setExpandedLines] = useState(new Set());

    useEffect(() => {
        setLoading(true);
        axios.get(`http://localhost:8000/api/brand-analysis?brand=${brand}`)
            .then(res => {
                // 노선명 가나다순, 역번호 숫자순으로 데이터 정렬
                const sorted = res.data.sort((a, b) => {
                    if (a.line !== b.line) return a.line.localeCompare(b.line);
                    return parseInt(a.station_id) - parseInt(b.station_id);
                });

                // 노선별로 데이터 그룹화
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

    // m 단위 거리 계산 함수 (Haversine 공식 적용)
    const getDistMeters = (lat1, lon1, lat2, lon2) => {
        if (!lat1 || !lon1 || !lat2 || !lon2) return null;
        const R = 6371000; 
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return Math.round(R * c);
    };

    const toggleLine = (lineName) => {
        const next = new Set(expandedLines);
        next.has(lineName) ? next.delete(lineName) : next.add(lineName);
        setExpandedLines(next);
    };

    if (loading) return (
        <div className={`analyzer-container mode-${mode}`}>
            <div className="analyzer-loading">☕ {brand} 데이터를 분석하고 있습니다...</div>
        </div>
    );

    return (
        <div className={`analyzer-container mode-${mode}`}>
            <div className="analyzer-header">
                <h2><span>{brand}</span> 입점 역 상세 분석</h2>
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
                            style={{ borderLeftColor: lineColors[line] || '#10B981' }}
                        >
                            <span className="line-name">{line}</span>
                            <span className="line-info">{stations.length}개 역 입점 {expandedLines.has(line) ? '▲' : '▼'}</span>
                        </button>

                        {expandedLines.has(line) && (
                            <div className="station-3-grid">
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
                                                {/* 매장 리스트를 렌더링 전 거리 계산 및 가까운 순 정렬 수행 */}
                                                {st.stores
                                                    .map(store => ({
                                                        ...store,
                                                        distance: getDistMeters(st.station_lat, st.station_lon, store.lat, store.lon)
                                                    }))
                                                    .sort((a, b) => a.distance - b.distance)
                                                    .map((store, idx) => (
                                                        <div key={idx} className="popover-item">
                                                            <div className="p-header">
                                                                <strong className="p-name">{store.name}</strong>
                                                                <span className="p-dist">{store.distance}m</span>
                                                            </div>
                                                            <div className="p-addr">{store.address}</div>
                                                        </div>
                                                    ))
                                                }
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
                <div className="analyzer-footer-spacer"></div>
            </div>
        </div>
    );
}

export default BrandAnalyzer;