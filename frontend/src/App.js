import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import './App.css';
import BrandAnalyzer from './BrandAnalyzer';
import { lineColors, clusterInfo, brandCategories, tileLayers } from './constants';

function App() {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const layerGroupRef = useRef(null);
  const polylineGroupRef = useRef(null);
  const tileLayerRef = useRef(null);

  const [allStations, setAllStations] = useState([]);
  const [displayStations, setDisplayStations] = useState([]);
  const [regions, setRegions] = useState([]);
  const [selectedStation, setSelectedStation] = useState(null);
  const [filterRegion, setFilterRegion] = useState('');
  const [mapMode, setMapMode] = useState('dark');
  
  const [activeAnalysisBrand, setActiveAnalysisBrand] = useState(null);

  useEffect(() => {
    axios.get('http://localhost:8000/api/stations')
      .then(res => {
        const sortedData = res.data.sort((a, b) => String(a.역번호).localeCompare(String(b.역번호)));
        setAllStations(sortedData);
        const uniqueRegions = ['전체', ...new Set(res.data.map(item => item.지역))];
        setRegions(uniqueRegions);
      })
      .catch(err => console.error(err));
  }, []);

  useEffect(() => {
    let filtered = filterRegion === '전체' ? allStations :
                  filterRegion !== '' ? allStations.filter(st => st.지역 === filterRegion) : [];
    setDisplayStations(filtered);
    setSelectedStation(null);

    if (!activeAnalysisBrand && filtered.length > 0 && mapInstance.current) {
      const lats = filtered.map(s => s.위도);
      const lons = filtered.map(s => s.경도);
      mapInstance.current.fitBounds(L.latLngBounds([Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]).pad(0.1));
    }
  }, [filterRegion, allStations, activeAnalysisBrand]);

  useEffect(() => {
    if (activeAnalysisBrand) {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
      return;
    }

    if (!mapRef.current) return;
    if (!mapInstance.current) {
      mapInstance.current = L.map(mapRef.current).setView([36.5, 127.8], 7);
      polylineGroupRef.current = L.layerGroup().addTo(mapInstance.current);
      layerGroupRef.current = L.layerGroup().addTo(mapInstance.current);
    }
    if (tileLayerRef.current) mapInstance.current.removeLayer(tileLayerRef.current);
    tileLayerRef.current = L.tileLayer(tileLayers[mapMode], { tileSize: 256, zoomOffset: 0 }).addTo(mapInstance.current);
  }, [mapMode, activeAnalysisBrand]);

  useEffect(() => {
    if (!mapInstance.current || activeAnalysisBrand) return;

    if (layerGroupRef.current) layerGroupRef.current.clearLayers();
    if (polylineGroupRef.current) polylineGroupRef.current.clearLayers();

    const visibleKeys = new Set(displayStations.map(s => s.역명 + s.노선명));
    const lineNames = [...new Set(allStations.map(s => s.노선명))];

    lineNames.forEach(lineName => {
      const stationsInLine = allStations
        .filter(s => s.노선명 === lineName)
        .sort((a, b) => String(a.역번호).localeCompare(String(b.역번호)));

      const color = lineColors[lineName] || '#9CA3AF';

      for (let i = 0; i < stationsInLine.length - 1; i++) {
        const s1 = stationsInLine[i];
        const s2 = stationsInLine[i + 1];
        if (!visibleKeys.has(s1.역명 + s1.노선명) || !visibleKeys.has(s2.역명 + s2.노선명)) continue;
        const dist = Math.sqrt(Math.pow(s1.위도 - s2.위도, 2) + Math.pow(s1.경도 - s2.경도, 2));
        
        const isException = 
          ((s1.역명 === '오목천' && s2.역명 === '어천') || (s1.역명 === '어천' && s2.역명 === '오목천')) ||
          ((s1.역명 === '마곡나루' && s2.역명 === '디지털미디어시티') || (s1.역명 === '디지털미디어시티' && s2.역명 === '마곡나루')) ||
          ((s1.역명 === '강촌' && s2.역명 === '김유정') || (s1.역명 === '김유정' && s2.역명 === '강촌')) ||
          ((s1.역명 === '대구한의대병원' && s2.역명 === '부호') || (s1.역명 === '부호' && s2.역명 === '대구한의대병원')) ||
          ((s1.역명 === '온양온천' && s2.역명 === '신창') || (s1.역명 === '신창' && s2.역명 === '온양온천')) ||
          ((s1.역명 === '경산' && s2.역명 === '왜관') || (s1.역명 === '왜관' && s2.역명 === '경산'));

        const relaxedLines = ['경강선', '경춘선', '공항철도', '경의중앙선', '수인분당선', '동해선', '대경선'];
        const maxDist = relaxedLines.includes(lineName) ? 0.8 : 0.05;

        if (dist > maxDist && !isException) continue;
        if (lineName === '2호선' && s1.역명 === '도림천' && s2.역명 === '신설동') continue;
        if (lineName === '1호선' && s1.역명 === '온수' && s2.역명 === '가산디지털단지') continue;
        if (lineName === '경의중앙선' && s1.역명 === '서울역' && s2.역명 === '홍대입구') continue;
        if (lineName === '2호선' && s1.역명 === '충정로' && s2.역명 === '용답') continue;

        L.polyline([[s1.위도, s1.경도], [s2.위도, s2.경도]], {
          color: color, weight: 3, opacity: 0.5
        }).addTo(polylineGroupRef.current);
      }

      const findVis = (name) => stationsInLine.find(s => s.역명 === name && visibleKeys.has(s.역명 + s.노선명));
      if (lineName === '1호선') {
        const guro = findVis('구로'), guil = findVis('구일'), gasan = findVis('가산디지털단지');
        if (guro && guil) L.polyline([[guro.위도, guro.경도], [guil.위도, guil.경도]], {color, weight:3, opacity:0.5}).addTo(polylineGroupRef.current);
        if (guro && gasan) L.polyline([[guro.위도, guro.경도], [gasan.위도, gasan.경도]], {color, weight:3, opacity:0.5}).addTo(polylineGroupRef.current);
      }
      if (lineName === '5호선') {
        const gd = findVis('강동'), gildong = findVis('길동'), dc = findVis('둔촌동');
        if (gd && gildong) L.polyline([[gd.위도, gd.경도], [gildong.위도, gildong.경도]], {color, weight:3, opacity:0.5}).addTo(polylineGroupRef.current);
        if (gd && dc) L.polyline([[gd.위도, gd.경도], [dc.위도, dc.경도]], {color, weight:3, opacity:0.5}).addTo(polylineGroupRef.current);
      }
      if (lineName === '2호선') {
        const cjr = findVis('충정로'), sc = findVis('시청'), sd = findVis('신도림'), dt = findVis('도림천'), ss = findVis('성수'), yd = findVis('용답');
        if (cjr && sc) L.polyline([[cjr.위도, cjr.경도], [sc.위도, sc.경도]], {color, weight:3, opacity:0.5}).addTo(polylineGroupRef.current);
        if (sd && dt) L.polyline([[sd.위도, sd.경도], [dt.위도, dt.경도]], {color, weight:3, opacity:0.5}).addTo(polylineGroupRef.current);
        if (ss && yd) L.polyline([[ss.위도, ss.경도], [yd.위도, yd.경도]], {color, weight:3, opacity:0.5}).addTo(polylineGroupRef.current);
      }
      if (lineName === '경의중앙선') {
        const gj = findVis('가좌'), sc = findVis('신촌'), hd = findVis('홍대입구');
        if (gj && sc) L.polyline([[gj.위도, gj.경도], [sc.위도, sc.경도]], {color, weight:3, opacity:0.5}).addTo(polylineGroupRef.current);
        if (gj && hd) L.polyline([[gj.위도, gj.경도], [hd.위도, hd.경도]], {color, weight:3, opacity:0.5}).addTo(polylineGroupRef.current);
      }
      if (lineName === '6호선') {
        const gusan = findVis('구산'), ea = findVis('응암');
        if (gusan && ea) L.polyline([[gusan.위도, gusan.경도], [ea.위도, ea.경도]], {color, weight:3, opacity:0.5}).addTo(polylineGroupRef.current);
      }
    });

    displayStations.forEach(st => {
      if (st.위도 && st.경도) {
        const color = lineColors[st.노선명] || '#9CA3AF';
        const squareIcon = L.divIcon({
          className: 'custom-square-marker',
          html: `<div style="background-color: ${color}; border: 2px solid #fff; width: 10px; height: 10px;"></div>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6]
        });
        const marker = L.marker([st.위도, st.경도], { icon: squareIcon }).addTo(layerGroupRef.current);
        marker.on('click', () => { setSelectedStation(st); });
      }
    });
  }, [displayStations, allStations, filterRegion, activeAnalysisBrand]);

  const getSelectedStationLines = () => {
    if (!selectedStation) return [];
    const sharedLines = allStations
      .filter(s => s.역명 === selectedStation.역명 && s.지역 === selectedStation.지역)
      .map(s => s.노선명);
    return [...new Set(sharedLines)];
  };

  const handleLineChange = (lineName) => {
    const targetData = allStations.find(s => 
      s.역명 === selectedStation.역명 && 
      s.지역 === selectedStation.지역 && 
      s.노선명 === lineName
    );
    if (targetData) setSelectedStation(targetData);
  };

  const handleBrandClick = (brandName) => {
    setActiveAnalysisBrand(brandName);
  };

  return (
    <div className={`dashboard-container mode-${mapMode}`}>
      <div className="sidebar">
        <div className="sidebar-top">
          <h1>전국 역세권 상권분석</h1>
          <div className="region-tabs">
            {regions.map(r => (
              <button key={r} className={filterRegion === r ? 'active' : ''} onClick={() => setFilterRegion(r)}>{r}</button>
            ))}
          </div>
          <div className="content-area">
            {selectedStation ? (
              <div className="detail-pill">
                <div className="badge-container">
                  {getSelectedStationLines().map(line => (
                    <button 
                      key={line} 
                      className={`line-badge-btn ${selectedStation.노선명 === line ? 'active' : ''}`}
                      style={{ borderColor: lineColors[line] || '#444' }}
                      onClick={() => handleLineChange(line)}
                    >
                      {line}
                    </button>
                  ))}
                </div>
                <h2>{selectedStation.역명}</h2>
                <div className="cluster-tag">{clusterInfo[selectedStation.클러스터].name}</div>
                <div className="info-grid">
                  <div className="info-item"><span>승하차객</span><strong>{selectedStation.총_승하차객수?.toLocaleString()}명</strong></div>
                  <div className="info-item"><span>브랜드 밀도</span><strong>{selectedStation.브랜드_밀도}개</strong></div>
                  <div className="info-item"><span>프리미엄 비율</span><strong className="text-premium">{(selectedStation.프리미엄_비율 * 100).toFixed(0)}%</strong></div>
                  <div className="info-item"><span>가성비 비율</span><strong className="text-budget">{(selectedStation.가성비_비율 * 100).toFixed(0)}%</strong></div>
                </div>
                {/* 초기화 버튼을 info-grid 아래로 배치 */}
                <button className="reset-pill-btn" onClick={() => setSelectedStation(null)}>가이드 보기</button>
              </div>
            ) : (
              <div className="guide-area">
                <div className="guide-pill">
                  <h3>📊 상권 클러스터 유형</h3>
                  {Object.entries(clusterInfo).map(([key, info]) => (
                    <div key={key} className="guide-item">
                      <b className="cluster-label">Type {key}</b>: <span>{info.name}</span>
                      <p>{info.desc}</p>
                    </div>
                  ))}
                </div>
                <div className="guide-pill">
                  <h3>☕ 브랜드 분류 기준</h3>
                  <div className="brand-button-container">
                    <div className="brand-col">
                      <span className="col-label premium">Premium</span>
                      {brandCategories.premium.map(brand => (
                        <button key={brand} className="brand-tag-btn" onClick={() => handleBrandClick(brand)}>{brand}</button>
                      ))}
                    </div>
                    <div className="brand-col">
                      <span className="col-label budget">Value</span>
                      {brandCategories.value.map(brand => (
                        <button key={brand} className="brand-tag-btn" onClick={() => handleBrandClick(brand)}>{brand}</button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="sidebar-bottom">
          <div className="mode-toggle">
            <button className={mapMode === 'light' ? 'active' : ''} onClick={() => setMapMode('light')}>Light</button>
            <div className="toggle-divider"></div>
            <button className={mapMode === 'dark' ? 'active' : ''} onClick={() => setMapMode('dark')}>Dark</button>
          </div>
        </div>
      </div>

      <div className="main-display-area">
        {activeAnalysisBrand ? (
          <BrandAnalyzer 
            brand={activeAnalysisBrand} 
            mode={mapMode} 
            onClose={() => setActiveAnalysisBrand(null)} 
          />
        ) : (
          <div ref={mapRef} className="map-area" />
        )}
      </div>
    </div>
  );
}

export default App;