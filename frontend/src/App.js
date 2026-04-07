import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import './App.css';
import { lineColors, clusterInfo, brandCategories, tileLayers } from './constants';

function App() {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const layerGroupRef = useRef(null);
  const tileLayerRef = useRef(null);
  
  const [allStations, setAllStations] = useState([]);
  const [displayStations, setDisplayStations] = useState([]);
  const [selectedStation, setSelectedStation] = useState(null);
  const [filterRegion, setFilterRegion] = useState(''); 
  const [mapMode, setMapMode] = useState('dark');

  useEffect(() => {
    axios.get('http://localhost:8000/api/stations')
      .then(res => setAllStations(res.data))
      .catch(err => console.error(err));
  }, []);

  useEffect(() => {
    if (filterRegion === '') {
      setDisplayStations([]);
    } else if (filterRegion === '전체') {
      setDisplayStations(allStations);
    } else {
      setDisplayStations(allStations.filter(st => st.지역 === filterRegion));
    }
    setSelectedStation(null);
  }, [filterRegion, allStations]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (!mapInstance.current) {
      mapInstance.current = L.map(mapRef.current, {
        zoomAnimation: true,
        fadeAnimation: true
      }).setView([37.5665, 126.978], 11);
      layerGroupRef.current = L.layerGroup().addTo(mapInstance.current);
    }

    if (tileLayerRef.current) {
      mapInstance.current.removeLayer(tileLayerRef.current);
    }
    
    tileLayerRef.current = L.tileLayer(tileLayers[mapMode], {
      attribution: '&copy; CARTO',
      tileSize: 256,
      zoomOffset: 0
    }).addTo(mapInstance.current);

  }, [mapMode]);

  useEffect(() => {
    if (layerGroupRef.current) layerGroupRef.current.clearLayers();

    displayStations.forEach(st => {
      if (st.위도 && st.경도) {
        const color = lineColors[st.노선명] || '#9CA3AF';
        const marker = L.circleMarker([st.위도, st.경도], {
          radius: 6, fillColor: color, color: '#fff', weight: 1, fillOpacity: 0.8
        });

        marker.bindPopup(`<div style="text-align:center;"><b>${st.역명}</b><br/>${st.노선명}</div>`, { closeButton: false });
        
        marker.on('click', () => {
          setSelectedStation(st);
          marker.openPopup();
        });

        marker.addTo(layerGroupRef.current);
      }
    });
  }, [displayStations]);

  return (
    <div className={`dashboard-container mode-${mapMode}`}>
      <div className="sidebar">
        <h1>수도권 상권 분석</h1>
        <div className="mode-toggle">
          <button className={mapMode === 'light' ? 'active' : ''} onClick={() => setMapMode('light')}>라이트</button>
          <button className={mapMode === 'dark' ? 'active' : ''} onClick={() => setMapMode('dark')}>다크</button>
        </div>
        <div className="region-tabs">
          {['전체', '서울', '경기', '인천'].map(r => (
            <button key={r} className={filterRegion === r ? 'active' : ''} onClick={() => setFilterRegion(r)}>{r}</button>
          ))}
        </div>
        <div className="content-area">
          {selectedStation ? (
            <div className="detail-card">
              <span className="line-badge" style={{backgroundColor: lineColors[selectedStation.노선명]}}>{selectedStation.노선명}</span>
              <h2>{selectedStation.역명}</h2>
              <div className="cluster-tag">{clusterInfo[selectedStation.클러스터].name}</div>
              <div className="info-grid">
                <div className="info-item"><span>승하차객</span><strong>{selectedStation.총_승하차객수?.toLocaleString()}명</strong></div>
                <div className="info-item"><span>브랜드 밀도</span><strong>{selectedStation.브랜드_밀도}개</strong></div>
                <div className="info-item"><span>프리미엄 비율</span><strong className="text-premium">{(selectedStation.프리미엄_비율 * 100).toFixed(0)}%</strong></div>
                <div className="info-item"><span>가성비 비율</span><strong className="text-budget">{(selectedStation.가성비_비율 * 100).toFixed(0)}%</strong></div>
              </div>
              <button className="reset-btn" onClick={() => setSelectedStation(null)}>분석 가이드 보기</button>
            </div>
          ) : (
            <div className="guide-area">
              <div className="guide-section">
                <h3>상권 클러스터 유형</h3>
                {Object.entries(clusterInfo).map(([key, info]) => (
                  <div key={key} className="guide-item">
                    <b className="cluster-label">Cluster {key}</b>: <span>{info.name}</span>
                    <p>{info.desc}</p>
                  </div>
                ))}
              </div>
              <div className="guide-section">
                <h3>브랜드 분류 기준</h3>
                <div className="brand-list premium">
                  <b>Premium:</b> {brandCategories.premium.join(', ')}
                </div>
                <div className="brand-list budget">
                  <b>Value:</b> {brandCategories.value.join(', ')}
                </div>
              </div>
              {filterRegion === '' && (
                <div className="start-msg">
                  <div className="pulse"></div>
                  <p>지역을 선택하여 분석을 시작하세요</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div ref={mapRef} className="map-area" />
    </div>
  );
}

export default App;