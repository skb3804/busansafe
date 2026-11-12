module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Vercel 환경변수에 GEMINI_API_KEY가 없습니다.' });
  }

  // 한국 표준시(KST) 기준 오늘 날짜 계산
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayStr = nowKst.toISOString().slice(0, 10);

  const prompt = `
오늘 날짜(${todayStr})를 기준으로 최근 3일간 대한민국 부산광역시에서 발생한 실제 소식을 Google 검색으로 찾아 아래 JSON 형식으로만 응답해줘. 마크다운 백틱(\`\`\`)이나 부가 설명 없이 순수 JSON 객체만 반환해.

1. "bannerHeadline": 현재 부산 지역 기상특보 및 재난 현황 한 줄 요약
2. "bannerSubtext": 시민 주의사항 한 줄 요약
3. "disasters": 부산 재해·재난·기상특보·산불예방·도로통제 관련 기사 4건
4. "incidents": 부산 사건·사고(화재, 교통사고, 치안, 산업재해 등) 기사 4건
5. "recentDays": 오늘 포함 최근 3일 날짜 배열

{
  "bannerHeadline": "부산 지역 기상특보 및 재난 현황 요약",
  "bannerSubtext": "해안가 및 도로 안전 유의",
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
      "category": "기상특보",
      "district": "부산 전역",
      "title": "기사 제목",
      "summary": "2문장 핵심 요약",
      "source": "발표 기관 또는 언론사명",
      "sourceUrl": "https://www.busan.go.kr/safety/index",
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
      "category": "사건·사고",
      "district": "해당 구·군",
      "title": "기사 제목",
      "summary": "2문장 핵심 요약",
      "source": "언론사명",
      "sourceUrl": "https://www.busan.go.kr",
      "publishedAt": "보도 일시",
      "status": "진행 상태",
      "content": "상세 본문 3~4문장"
    }
  ]
}
`;

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        error: 'Gemini API 호출 거부됨',
        status: response.status,
        detail: data
      });
    }

    // 텍스트 파트 추출
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const rawText = parts.map((p) => p.text || '').join('\n').trim();

    // JSON 영역({ ... })만 안전하게 추출
    const jsonStart = rawText.indexOf('{');
    const jsonEnd = rawText.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) {
      return res.status(500).json({
        error: 'JSON 형식을 찾지 못했습니다.',
        rawText
      });
    }

    const cleanedJson = rawText.slice(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(cleanedJson);

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate');
    return res.status(200).json(parsed);
  } catch (error) {
    return res.status(500).json({
      error: '서버 실행 오류',
      message: error.message
    });
  }
};
