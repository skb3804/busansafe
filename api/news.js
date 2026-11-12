export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Vercel 환경변수에 GEMINI_API_KEY가 설정되지 않았습니다.' });
  }

  // 한국 표준시(KST) 기준 오늘 날짜 및 최근 3일 계산
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayStr = nowKst.toISOString().slice(0, 10);

  const prompt = `
오늘 날짜(${todayStr})를 기준으로 최근 3일간 대한민국 부산광역시에서 발생한 실제 소식을 Google 검색으로 찾아 아래 JSON 형식으로만 응답해줘. 마크다운 백틱(\`\`\`) 없이 순수 JSON만 반환해.

1. "bannerHeadline": 현재 부산 지역 기상특보 및 재난 현황 한 줄 요약
2. "bannerSubtext": 시민 주의사항 한 줄 요약
3. "disasters": 부산 재해·재난·기상특보·산불예방·도로통제 관련 기사 4건
4. "incidents": 부산 사건·사고(화재, 교통사고, 치안, 산업재해 등) 기사 4건
5. "recentDays": 오늘 포함 최근 3일 날짜 배열 (예: [{"date":"2026-11-12","label":"11월 12일 (목 · 오늘)"}, ...])

{
  "bannerHeadline": "남해동부먼바다 풍랑특보 현황 · 육상 특보 안내",
  "bannerSubtext": "해안가 너울 및 야간 도로 통제 유의",
  "recentDays": [
    { "date": "${todayStr}", "label": "오늘" }
  ],
  "disasters": [
    {
      "id": "dis-1",
      "type": "disaster",
      "date": "${todayStr}",
      "dateLabel": "오늘",
      "severity": "주의",
      "category": "해상/풍랑특보",
      "district": "해당 구·군 또는 부산 전역",
      "title": "기사 제목",
      "summary": "2문장 핵심 요약",
      "source": "발표 기관 또는 언론사명",
      "sourceUrl": "원문 URL",
      "publishedAt": "발표 일시",
      "actionGuide": "시민 행동요령 1~2문장",
      "content": "상세 본문 3~4문장"
    }
  ],
  "incidents": [
    {
      "id": "inc-1",
      "type": "incident",
      "date": "${todayStr}",
      "dateLabel": "오늘",
      "category": "화재 또는 교통사고 또는 치안 또는 산업재해",
      "district": "해당 구·군",
      "title": "기사 제목",
      "summary": "2문장 핵심 요약",
      "source": "언론사명",
      "sourceUrl": "원문 URL",
      "publishedAt": "보도 일시",
      "status": "진행 상태(예: 진화 완료, 경찰 수사 중)",
      "content": "상세 본문 3~4문장"
    }
  ]
}
`;

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }]
      })
    });

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const cleanedJson = rawText.replace(/
```json|```/g, '').trim();
    const parsed = JSON.parse(cleanedJson);

    // 10분 캐시 적용으로 빠른 로딩 및 API 호출량 절약
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate');
    return res.status(200).json(parsed);
  } catch (error) {
    return res.status(500).json({ error: '실시간 뉴스 수집 중 오류가 발생했습니다.', detail: error.message });
  }
}