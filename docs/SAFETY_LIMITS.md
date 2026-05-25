# Safety Limits (Part 3)

## Budget guard

- Default **$0** estimated cost per day  
- Warn 80%, high-risk 90%, stop 100% of per-metric caps  
- Tracks: email scans, company scans, jobs saved, jobs analyzed, AI calls, DB reads/writes  

## AI cache

Before Gemini:

- Check `ai_cache` by job description hash  
- Skip Gemini in mock mode (logged)  
- Skip when `use_gemini` off or cost cap $0  

## Human-like activity guard

- Delay between company scans  
- Delay between email batches  
- No outreach, no apply submission in Part 3  

## Blocked actions

Logged when:

- Captcha / blocked website  
- Missing Gmail or Supabase setup  
- Daily limits / cost risk  
- Low trust or fit  
- Duplicate application risk  

## Emergency stop

When ON, all agent actions are blocked immediately.
