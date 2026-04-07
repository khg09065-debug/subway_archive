import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import './App.css';

const lineColors = {
  '1호선': '#0052A4', '2호선': '#00A84D', '3호선': '#EF7C1C', '4호선': '#00A5DE',
  '5호선': '#996CAC', '6호선': '#CD7C2F', '7호선': '#747F00', '8호선': '#E6186C',
  '9호선': '#BB8336', '수인분당선': '#F5A200', '경의중앙선': '#77C4A3', '신분당선': '#D4003B',
  '우이신설선': '#B0AD00', '공항철도': '#0090D2', '경춘선': '#1AB878'
};

function App() {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const layerGroupRef = useRef(null);
  const [stations, setStations] = useState([]);
  const [selectedStation, setSelectedStation] = useState(null);

  useEffect(() => {
    axios.get('http://localhost:8000/api/stations')
      .then(res => setStations(res.data))
      .catch(err => console.error(err));
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    if (!mapInstance.current) {
      mapInstance.current = L.map(mapRef.current).setView([37.5665, 126.978], 12);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(mapInstance.current);
      layerGroupRef.current = L.layerGroup().addTo(mapInstance.current);
    }

    if (layerGroupRef.current) layerGroupRef.current.clearLayers();

    stations.forEach(st => {
      if (st.위도 && st.경도) {
        const color = lineColors[st.노선명] || '#9CA3AF';
        
        // 둥그런 점(마커) 생성
        const marker = L.circleMarker([st.위도, st.경도], {
          radius: 6,
          fillColor: color,
          color: '#fff',
          weight: 1,
          fillOpacity: 0.8
        });

        // 클릭 시에만 이름이 보이는 팝업 설정
        marker.bindPopup(`
          <div style="text-align:center; font-family: 'Malgun Gothic'; min-width: 80px;">
            <b style="font-size:14px; color:${color}">${st.역명}</b><br/>
            <span style="font-size:11px; color:#555;">${st.노선명}</span>
          </div>
        `, { closeButton: false, offset: [0, -5] });

        // 마커 클릭 시 이벤트
        marker.on('click', () => {
          setSelectedStation(st); // 사이드바 데이터 업데이트
          marker.openPopup();    // 지도 위 팝업 표시
        });

        marker.addTo(layerGroupRef.current);
      }
    });
  }, [stations]);

  return (
    <div className="dashboard-container">
      <div className="sidebar">
        <h1>서울 상권 분석</h1>
        <div className="content-area">
          {selectedStation ? (
            <div className="detail-card">
              <span className="line-badge" style={{backgroundColor: lineColors[selectedStation.노선명]}}>{selectedStation.노선명}</span>
              <h2>{selectedStation.역명}</h2>
              <div className="cluster-result">
                <p>클러스터 결과</p>
                <div className="cluster-value">Cluster {selectedStation.클러스터}</div>
              </div>
              <div className="info-row">
                <span>승하차객:</span> <strong>{selectedStation.총_승하차객수?.toLocaleString()}명</strong>
              </div>
              <div className="info-row">
                <span>브랜드 밀도:</span> <strong>{selectedStation.브랜드_밀도}</strong>
              </div>
              <button className="reset-btn" onClick={() => setSelectedStation(null)}>전체 통계 보기</button>
            </div>
          ) : (
            <div className="stats-box">
              <p>분석 대상 역: <span>{stations.length}</span>개</p>
              <p className="hint">지도의 컬러 점을 클릭하면<br/>역 이름과 상세 분석이 나타납니다.</p>
              <div className="legend-list">
                {Object.entries(lineColors).slice(0, 9).map(([line, col]) => (
                  <div key={line} className="legend-item">
                    <span style={{backgroundColor: col}}></span>{line}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div ref={mapRef} className="map-area" />
    </div>
  );
}

export default App;