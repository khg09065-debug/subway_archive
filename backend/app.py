from flask import Flask, jsonify, request
from flask_cors import CORS
import pandas as pd
import numpy as np
from sqlalchemy import create_engine
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from math import radians, cos, sin, asin, sqrt
import os
from dotenv import load_dotenv

# .env 로드
load_dotenv()

app = Flask(__name__)
CORS(app)

# --- [1. 환경 설정 및 DB 연결] ---
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_USER = os.getenv("DB_USER", "root")
DB_PASS = os.getenv("DB_PASSWORD", "1234")
DB_NAME = os.getenv("DB_NAME", "coffee_store")

engine = create_engine(f'mysql+pymysql://{DB_USER}:{DB_PASS}@{DB_HOST}:3306/{DB_NAME}')

# 브랜드 분류 기준
premium_brands = ['스타벅스', '투썸플레이스', '폴바셋', '할리스', '파스쿠찌', '공차', '디저트39']
budget_brands = ['메가커피', '빽다방', '컴포즈커피', '더벤티', '메머드커피', '이디야', '던킨도너츠', '하삼동커피']

# --- [2. 유틸리티 함수] ---
def haversine(lon1, lat1, lon2, lat2):
    """하버사인 거리 계산 (수정 금지)"""
    lon1, lat1, lon2, lat2 = map(radians, [lon1, lat1, lon2, lat2])
    dlon, dlat = lon2 - lon1, lat2 - lat1
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    return 6371 * 2 * asin(sqrt(a))

def get_station_features(station_row, stores_df):
    """역 주변 상권 특성 추출"""
    s_lat, s_lon = station_row['위도'], station_row['경도']
    nearby = stores_df[
        (stores_df['위도'].between(s_lat - 0.01, s_lat + 0.01)) & 
        (stores_df['경도'].between(s_lon - 0.01, s_lon + 0.01))
    ].copy()
    
    if nearby.empty: return pd.Series([0, 0.0, 0.0, 0])
    
    nearby['dist'] = nearby.apply(lambda x: haversine(s_lon, s_lat, x['경도'], x['위도']), axis=1)
    in_500m = nearby[nearby['dist'] <= 0.5]
    
    total_count = len(in_500m)
    if total_count == 0: return pd.Series([0, 0.0, 0.0, 0])
    
    p_ratio = round(in_500m['브랜드명'].isin(premium_brands).sum() / total_count, 2)
    b_ratio = round(in_500m['브랜드명'].isin(budget_brands).sum() / total_count, 2)
    diversity = in_500m['브랜드명'].nunique()
    
    return pd.Series([total_count, p_ratio, b_ratio, diversity])

# --- [3. 메인 분석 및 클러스터링 로직] ---
STATION_ANALYSIS_RESULTS = []
COFFEE_STORES_DF = pd.DataFrame()

def run_realtime_clustering():
    global STATION_ANALYSIS_RESULTS, COFFEE_STORES_DF
    print("🚀 [분석 시작] test_model 로직을 적용한 고도화 분석을 시작합니다.")
    
    # 1. 데이터 로드 (DB 및 CSV)
    COFFEE_STORES_DF = pd.read_sql("SELECT 브랜드명, 매장명, 주소, 경도, 위도 FROM coffee_chain", engine)
    station_df = pd.read_csv('전체_역사정보_최종_정제_v52.csv')
    stations = station_df.dropna(subset=['위도', '경도']).copy()
    stations['총_승하차객수'] = stations['1월 승차이용객수'] + stations['1월 하차이용객수']

    # 2. 피처 추출
    features = stations.apply(lambda x: get_station_features(x, COFFEE_STORES_DF), axis=1)
    features.columns = ['브랜드_밀도', '프리미엄_비율', '가성비_비율', '브랜드_다양성']
    final_df = pd.concat([stations, features], axis=1)

    # 3. 모델 고도화 전처리 (test_model.py 기준)
    # 3-1. 이상치 처리: 승하차객수 로그 변환
    final_df['총_승하차객수_log'] = np.log1p(final_df['총_승하차객수'])

    # 3-2. 스케일링 및 가중치 부여
    target_cols = ['총_승하차객수_log', '브랜드_밀도', '프리미엄_비율', '가성비_비율', '브랜드_다양성']
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(final_df[target_cols].fillna(0))
    
    # [가중치 설정] 브랜드 밀도(2.5)와 상권 성격(1.5)에 집중하여 '무늬만 역세권'을 걸러냄
    weights = np.array([1.0, 2.5, 1.5, 1.5, 1.2]) 
    X_weighted = X_scaled * weights

    # 4. K-Means 군집화 (n_init=30으로 신뢰도 향상)
    kmeans = KMeans(n_clusters=4, random_state=42, n_init=30)
    final_df['클러스터'] = kmeans.fit_predict(X_weighted)

    # 5. [추가] 클러스터 의미 정의 로직
    # 군집별 평균값을 계산하여 성격을 파악합니다.
    cluster_means = final_df.groupby('클러스터')[['총_승하차객수', '브랜드_밀도', '프리미엄_비율', '가성비_비율']].mean()
    
    cluster_desc = {}
    for cluster_id in range(4):
        row = cluster_means.loc[cluster_id]
        if row['브랜드_밀도'] > cluster_means['브랜드_밀도'].mean() and row['총_승하차객수'] > cluster_means['총_승하차객수'].mean():
            desc = "초대형 핵심 광역 상권 (강남역 등 유동인구와 브랜드 밀도가 모두 최상인 지역)"
        elif row['프리미엄_비율'] > row['가성비_비율'] and row['프리미엄_비율'] > 0.45:
            desc = "고급/오피스 프리미엄 상권 (스타벅스 등 고급 브랜드 선호도가 높은 비즈니스 지역)"
        elif row['가성비_비율'] > row['프리미엄_비율'] and row['브랜드_밀도'] > 5:
            desc = "생활 밀착형 활성 상권 (메가커피 등 가성비 브랜드가 밀집된 실질적 소비 지역)"
        else:
            desc = "저밀도 주거/교외 상권 (상업 시설보다는 주거 또는 교통 거점 기능이 강한 지역)"
        cluster_desc[cluster_id] = desc
        print(f"📍 군집 {cluster_id} 정의: {desc}")

    # 최종 데이터에 의미 추가
    final_df['상권_성격'] = final_df['클러스터'].map(cluster_desc)
    
    STATION_ANALYSIS_RESULTS = final_df.fillna("").to_dict(orient='records')
    print("✅ [분석 완료] 데이터가 성공적으로 업데이트되었습니다.")

run_realtime_clustering()

# --- [4. API 엔드포인트] ---
@app.route('/api/stations')
def get_stations():
    return jsonify(STATION_ANALYSIS_RESULTS)

@app.route('/api/brand-analysis')
def get_brand_analysis():
    brand = request.args.get('brand')
    if not brand: return jsonify([])
    
    brand_stores = COFFEE_STORES_DF[COFFEE_STORES_DF['브랜드명'] == brand].copy()
    result = []
    
    for station in STATION_ANALYSIS_RESULTS:
        s_lat, s_lon = station['위도'], station['경도']
        nearby = brand_stores[
            (brand_stores['위도'].between(s_lat - 0.01, s_lat + 0.01)) & 
            (brand_stores['경도'].between(s_lon - 0.01, s_lon + 0.01))
        ].copy()
        
        if nearby.empty: continue
        
        nearby['dist'] = nearby.apply(lambda x: haversine(s_lon, s_lat, x['경도'], x['위도']), axis=1)
        in_500m = nearby[nearby['dist'] <= 0.5]
        
        if not in_500m.empty:
            stores = in_500m.apply(lambda x: {
                "name": x['매장명'],
                "address": x['주소'],
                "lat": x['위도'],
                "lon": x['경도']
            }, axis=1).tolist()
            
            result.append({
                "station_name": station['역명'],
                "line": station['노선명'],
                "station_id": str(station['역번호']),
                "station_lat": station['위도'],
                "station_lon": station['경도'],
                "stores": stores
            })
            
    return jsonify(result)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000, debug=True)