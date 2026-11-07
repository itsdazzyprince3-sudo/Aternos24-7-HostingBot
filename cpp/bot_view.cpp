// bot_view.cpp - First-person software raycaster viewer for the Mineflayer bot.
// Connects to the Node frame-server, raycasts the bot's voxel grid into an RGB
// framebuffer, and serves a live view over HTTP as BMP (no GPU, no image libs).
// Language: C++17, target: Linux, g++. Build: g++ -O2 -std=c++17 -pthread bot_view.cpp -o bot_view
// Run: ./bot_view [--mock] [--frame-host 127.0.0.1] [--frame-port 31337] [--http-port 8080] [--w 480] [--h 270]
#define _GNU_SOURCE
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cmath>
#include <cstdint>
#include <vector>
#include <string>
#include <thread>
#include <mutex>
#include <atomic>
#include <chrono>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <netinet/tcp.h>
#include <cerrno>
#include <algorithm>

// ---- config ----
static int RES_W = 480, RES_H = 270;
static float FOV = 1.2217f; // 70 deg
static std::string FRAME_HOST = "127.0.0.1";
static int FRAME_PORT = 31337;
static int HTTP_PORT = 8080;
static bool MOCK = false;

// ---- palette: 16 kinds (R,G,B) ----
static const uint8_t PAL[16][3] = {
  {135,206,235}, // 0 air/sky fallback (unused for solids)
  {130,130,135}, // 1 stone
  {134, 96, 67}, // 2 dirt
  { 86,140, 57}, // 3 grass
  {102, 76, 46}, // 4 wood
  { 60,110, 46}, // 5 leaves
  {218,201,138}, // 6 sand
  { 54,108,200}, // 7 water
  { 80,200,210}, // 8 ore
  {220, 90, 20}, // 9 lava
  {235,240,245}, // 10 snow/ice
  {200,220,230}, // 11 glass
  {120,180, 80}, // 12 plant
  { 90, 40, 40}, // 13 netherrack
  { 40, 40, 45}, // 14 bedrock/obsidian
  {150,150,150}, // 15 generic
};
static const uint8_t SKY[3] = {135,206,235};

struct Ent { float rel[3]; uint8_t kind; std::string name; };
struct Frame {
  float eye[3]; float yaw, pitch; int origin[3]; int W,H,D;
  std::vector<uint8_t> grid; std::vector<Ent> ents;
  long long ts = 0;
};

static std::mutex g_mtx;
static Frame g_frame;
static std::atomic<bool> g_running{true};
static std::vector<uint8_t> g_fb; // RGB framebuffer
static std::mutex g_fb_mtx;
static int g_fbW=0, g_fbH=0;
static std::atomic<int> g_fps{0};

// ---- tiny helpers ----
static bool readn(int fd, void* buf, size_t n) {
  size_t got = 0; uint8_t* p = (uint8_t*)buf;
  while (got < n) {
    ssize_t r = recv(fd, p+got, n-got, 0);
    if (r <= 0) return false;
    got += (size_t)r;
  }
  return true;
}
static uint16_t rdU16(const uint8_t* p){ return p[0]|(p[1]<<8); }
static int32_t  rdI32(const uint8_t* p){ return (int32_t)(p[0]|(p[1]<<8)|(p[2]<<16)|(p[3]<<24)); }
static float    rdF32(const uint8_t* p){ uint32_t u=p[0]|(p[1]<<8)|(p[2]<<16)|(p[3]<<24); float f; memcpy(&f,&u,4); return f; }

static void vsub(const float a[3], const float b[3], float o[3]){ o[0]=a[0]-b[0];o[1]=a[1]-b[1];o[2]=a[2]-b[2]; }
static float vlen(const float a[3]){ return sqrtf(a[0]*a[0]+a[1]*a[1]+a[2]*a[2]); }
static void cross(const float a[3],const float b[3],float o[3]){ o[0]=a[1]*b[2]-a[2]*b[1]; o[1]=a[2]*b[0]-a[0]*b[2]; o[2]=a[0]*b[1]-a[1]*b[0]; }
static float dot(const float a[3],const float b[3]){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
static void normv(float a[3]){ float l=vlen(a); if(l>1e-9){a[0]/=l;a[1]/=l;a[2]/=l;} }

// kindAt: index = x + W*z + W*D*y  (matches Node write order y,z,x)
static uint8_t kindAt(const Frame& f, int x,int y,int z){
  if(x<0||y<0||z<0||x>=f.W||y>=f.H||z>=f.D) return 0;
  return f.grid[(size_t)x + (size_t)f.W*z + (size_t)f.W*f.D*y];
}

// ---- raycast one pixel into framebuffer ----
static void renderFrame(const Frame& f, std::vector<uint8_t>& fb, int W,int H){
  // eye in grid space
  float e[3] = { f.eye[0]-f.origin[0], f.eye[1]-f.origin[1], f.eye[2]-f.origin[2] };
  // forward from yaw/pitch (convention; flip signs here if view is mirrored)
  float fwd[3] = { sinf(f.yaw)*cosf(f.pitch), -sinf(f.pitch), cosf(f.yaw)*cosf(f.pitch) };
  normv(fwd);
  float upw[3]={0,1,0};
  if(fabsf(dot(fwd,upw))>0.99f){ upw[0]=0;upw[1]=0;upw[2]=1; }
  float right[3]; cross(fwd,upw,right); normv(right);
  float up[3]; cross(right,fwd,up); normv(up);
  float focal = (W/2.0f)/tanf(FOV/2.0f);
  float maxDist = (float)std::max(f.W,std::max(f.H,f.D));
  for(int py=0; py<H; ++py){
    for(int px=0; px<W; ++px){
      float nx = (2.0f*(px+0.5f)/W - 1.0f);
      float ny = (1.0f - 2.0f*(py+0.5f)/H);
      float dir[3] = { fwd[0]+right[0]*nx*focal/(W/2.0f)* (W/2.0f), fwd[1]+up[1]*ny*focal/(W/2.0f)*(W/2.0f), 0 };
      // simpler: ray = fwd + right*nx*tanHalf + up*ny*tanHalf*aspect
      float tanHalf = tanf(FOV/2.0f);
      float aspect = (float)W/(float)H;
      dir[0] = fwd[0] + right[0]*nx*tanHalf*aspect + up[0]*ny*tanHalf;
      dir[1] = fwd[1] + right[1]*nx*tanHalf*aspect + up[1]*ny*tanHalf;
      dir[2] = fwd[2] + right[2]*nx*tanHalf*aspect + up[2]*ny*tanHalf;
      normv(dir);
      // DDA
      int ix=(int)floorf(e[0]), iy=(int)floorf(e[1]), iz=(int)floorf(e[2]);
      int stepX = dir[0]>0?1:(dir[0]<0?-1:1);
      int stepY = dir[1]>0?1:(dir[1]<0?-1:1);
      int stepZ = dir[2]>0?1:(dir[2]<0?-1:1);
      float dx = dir[0]==0?1e-9f:dir[0];
      float dy = dir[1]==0?1e-9f:dir[1];
      float dz = dir[2]==0?1e-9f:dir[2];
      float tMaxX = (dir[0]>0 ? (ix+1-e[0]) : (e[0]-ix)) / fabsf(dx);
      float tMaxY = (dir[1]>0 ? (iy+1-e[1]) : (e[1]-iy)) / fabsf(dy);
      float tMaxZ = (dir[2]>0 ? (iz+1-e[2]) : (e[2]-iz)) / fabsf(dz);
      float tDX = fabsf(1.0f/dx), tDY=fabsf(1.0f/dy), tDZ=fabsf(1.0f/dz);
      uint8_t col[3] = {SKY[0],SKY[1],SKY[2]};
      float t=0; int lastAxis=-1; bool hit=false;
      // start cell
      uint8_t k0 = kindAt(f,ix,iy,iz);
      if(k0!=0){ hit=true; t=0; lastAxis=1; }
      for(int steps=0; steps<768 && !hit; ++steps){
        if(tMaxX<tMaxY && tMaxX<tMaxZ){ ix+=stepX; t=tMaxX; tMaxX+=tDX; lastAxis=0; }
        else if(tMaxY<tMaxZ){ iy+=stepY; t=tMaxY; tMaxY+=tDY; lastAxis=1; }
        else { iz+=stepZ; t=tMaxZ; tMaxZ+=tDZ; lastAxis=2; }
        if(t>maxDist) break;
        uint8_t k = kindAt(f,ix,iy,iz);
        if(k!=0){ hit=true; }
      }
      if(hit){
        uint8_t k = kindAt(f,ix,iy,iz);
        const uint8_t* base = PAL[k<16?k:15];
        float b;
        if(lastAxis==1) b = (stepY>0)?0.5f:1.0f;     // bottom/top
        else if(lastAxis==0) b = 0.8f;                // x side
        else b = 0.6f;                                // z side
        // fog
        float fog = 1.0f - std::min(1.0f, t/maxDist);
        fog = fog*0.85f + 0.15f;
        col[0] = (uint8_t)(base[0]*b*fog + SKY[0]*(1.0f-fog));
        col[1] = (uint8_t)(base[1]*b*fog + SKY[1]*(1.0f-fog));
        col[2] = (uint8_t)(base[2]*b*fog + SKY[2]*(1.0f-fog));
      }
      size_t off = ((size_t)py*W + px)*3;
      fb[off]=col[0]; fb[off+1]=col[1]; fb[off+2]=col[2];
    }
  }
  // entities as billboards
  for(const Ent& en : f.ents){
    float fd = dot(en.rel, fwd);
    if(fd <= 0.3f) continue;
    float rd = dot(en.rel, right);
    float ud = dot(en.rel, up);
    int sx = (int)(W/2.0f + rd/fd * focal);
    int sy = (int)(H/2.0f - ud/fd * focal);
    int half = (int)std::max(2.0f, focal*0.12f/fd);
    uint8_t ec[3];
    if(en.kind==2){ ec[0]=60; ec[1]=220; ec[2]=80; }      // player green
    else if(en.kind==1){ ec[0]=220; ec[1]=60; ec[2]=60; } // mob red
    else { ec[0]=230; ec[1]=200; ec[2]=60; }             // other yellow
    for(int yy=sy-half; yy<=sy+half; ++yy)
      for(int xx=sx-half; xx<=sx+half; ++xx){
        if(xx<0||yy<0||xx>=W||yy>=H) continue;
        size_t off=((size_t)yy*W+xx)*3;
        fb[off]=ec[0]; fb[off+1]=ec[1]; fb[off+2]=ec[2];
      }
  }
}

// ---- mock world ----
static Frame mockFrame(){
  Frame f;
  f.W=64; f.H=48; f.D=64;
  f.origin[0]=-32; f.origin[1]=0; f.origin[2]=-32;
  f.grid.assign((size_t)f.W*f.H*f.D, 0);
  auto set=[&](int x,int y,int z,uint8_t k){ if(x>=0&&y>=0&&z>=0&&x<f.W&&y<f.H&&z<f.D) f.grid[(size_t)x+f.W*z+f.W*f.D*y]=k; };
  for(int x=0;x<f.W;++x) for(int z=0;z<f.D;++z){ set(x,0,z,3); set(x,1,z,2); set(x,2,z,1); }
  for(int x=8;x<12;++x) for(int z=8;z<12;++z) set(x,3,z,4);
  // pillars
  for(int y=0;y<14;++y){ set(20,y,20,4); set(40,y,10,1); set(50,y,50,8); set(10,y,40,6); }
  for(int y=3;y<6;++y){ set(30,y,30,5); set(31,y,30,5); set(30,y,31,5); set(31,y,31,5); }
  set(25,3,25,9); // lava
  f.eye[0]=0; f.eye[1]=7; f.eye[2]=0; // grid space eye = (0,7,0)+origin = (0+0,7+0,0+0)...
  // eye in world = origin + eyeGrid; we store eye in WORLD coords; renderer subtracts origin.
  f.eye[0]=f.origin[0]+0; f.eye[1]=f.origin[1]+7; f.eye[2]=f.origin[2]+0;
  f.yaw = 0.0f; f.pitch = -0.15f;
  f.ents.push_back({{8.0f,1.0f,8.0f},2,"Steve"});
  f.ents.push_back({{-6.0f,0.0f,5.0f},1,"Zombie"});
  f.ts = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
  return f;
}

// ---- TCP frame client thread ----
static void frameClient(){
  while(g_running.load()){
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if(fd<0){ std::this_thread::sleep_for(std::chrono::seconds(1)); continue; }
    sockaddr_in addr{}; addr.sin_family=AF_INET; addr.sin_port=htons(FRAME_PORT);
    inet_pton(AF_INET, FRAME_HOST.c_str(), &addr.sin_addr);
    if(connect(fd,(sockaddr*)&addr,sizeof(addr))!=0){ close(fd); std::this_thread::sleep_for(std::chrono::seconds(1)); continue; }
    int one=1; setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one));
    // read frames
    while(g_running.load()){
      uint8_t head[43];
      if(!readn(fd, head, 43)) break;
      if(memcmp(head,"VFRM",4)!=0) break;
      // version head[4]
      Frame nf;
      nf.eye[0]=rdF32(head+5); nf.eye[1]=rdF32(head+9); nf.eye[2]=rdF32(head+13);
      nf.yaw=rdF32(head+17); nf.pitch=rdF32(head+21);
      nf.origin[0]=rdI32(head+25); nf.origin[1]=rdI32(head+29); nf.origin[2]=rdI32(head+33);
      nf.W=rdU16(head+37); nf.H=rdU16(head+39); nf.D=rdU16(head+41);
      if(nf.W<=0||nf.W>512||nf.H<=0||nf.H>512||nf.D<=0||nf.D>512) break;
      size_t gridN=(size_t)nf.W*nf.H*nf.D;
      nf.grid.resize(gridN);
      if(!readn(fd, nf.grid.data(), gridN)) break;
      uint8_t ec[2];
      if(!readn(fd, ec, 2)) break;
      int entCount = rdU16(ec);
      for(int i=0;i<entCount && i<256;++i){
        uint8_t eb[14];
        if(!readn(fd, eb, 14)) { entCount=-1; break; }
        Ent en; en.rel[0]=rdF32(eb); en.rel[1]=rdF32(eb+4); en.rel[2]=rdF32(eb+8);
        en.kind=eb[12]; int nl=eb[13];
        if(nl>0){ std::vector<uint8_t> nb(nl); if(!readn(fd,nb.data(),nl)){ entCount=-1; break; } en.name.assign((char*)nb.data(), nl); }
        nf.ents.push_back(en);
      }
      if(entCount<0) break;
      nf.ts = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
      { std::lock_guard<std::mutex> lk(g_mtx); g_frame = std::move(nf); }
    }
    close(fd);
    std::this_thread::sleep_for(std::chrono::seconds(1));
  }
}

// ---- renderer thread ----
static void renderer(){
  int W=RES_W,H=RES_H; std::vector<uint8_t> fb((size_t)W*H*3);
  g_fbW=W; g_fbH=H;
  auto last=std::chrono::steady_clock::now(); int frames=0; int fpsAcc=0;
  while(g_running.load()){
    Frame f;
    { std::lock_guard<std::mutex> lk(g_mtx); f = g_frame; }
    if(MOCK && f.ts==0) f = mockFrame();
    if(f.ts!=0 || MOCK){
      if(MOCK && f.ts==0){ std::lock_guard<std::mutex> lk(g_mtx); g_frame = f; }
      renderFrame(f, fb, W, H);
      { std::lock_guard<std::mutex> lk(g_fb_mtx); g_fb = fb; }
      frames++;
    }
    auto now=std::chrono::steady_clock::now();
    auto dt=std::chrono::duration_cast<std::chrono::milliseconds>(now-last).count();
    if(dt>=1000){ fpsAcc=(int)(frames*1000/dt); g_fps.store(fpsAcc); frames=0; last=now; }
    std::this_thread::sleep_for(std::chrono::milliseconds(33));
  }
}

// ---- BMP encode ----
static std::vector<uint8_t> toBmp(const std::vector<uint8_t>& rgb,int W,int H){
  int rowBytes = W*3;
  int pad = (4-(rowBytes%4))%4;
  int rowSize = rowBytes+pad;
  int fileSize = 54 + rowSize*H;
  std::vector<uint8_t> b(fileSize);
  b[0]='B'; b[1]='M';
  uint32_t fs=fileSize; memcpy(b.data()+2,&fs,4);
  b[6]=b[7]=b[8]=b[9]=0;
  uint32_t off=54; memcpy(b.data()+10,&off,4);
  uint32_t hdr=40; memcpy(b.data()+14,&hdr,4);
  int32_t w=W,h=H; memcpy(b.data()+18,&w,4); memcpy(b.data()+22,&h,4);
  uint16_t planes=1; memcpy(b.data()+26,&planes,2);
  uint16_t bpp=24; memcpy(b.data()+28,&bpp,2);
  uint32_t zero=0; memcpy(b.data()+30,&zero,4);
  uint32_t isz=rowSize*H; memcpy(b.data()+34,&isz,4);
  uint32_t ppm=2835; memcpy(b.data()+38,&ppm,4); memcpy(b.data()+42,&ppm,4);
  memcpy(b.data()+46,&zero,4); memcpy(b.data()+50,&zero,4);
  // rows bottom-up, BGR
  for(int y=0;y<H;++y){
    int srcRow = H-1-y;
    uint8_t* dst = b.data()+54 + y*rowSize;
    const uint8_t* src = rgb.data() + (size_t)srcRow*W*3;
    for(int x=0;x<W;++x){ dst[x*3]=src[x*3+2]; dst[x*3+1]=src[x*3+1]; dst[x*3+2]=src[x*3]; }
    for(int p=0;p<pad;++p) dst[W*3+p]=0;
  }
  return b;
}

static void sendAll(int fd,const uint8_t* d,size_t n){
  size_t s=0; while(s<n){ ssize_t w=send(fd,d+s,n-s,0); if(w<=0) return; s+=(size_t)w; }
}
static void httpReply(int fd,int code,const char* ct,const uint8_t* body,size_t len){
  char head[256];
  int n=snprintf(head,sizeof(head),
    "HTTP/1.1 %d %s\r\nContent-Type: %s\r\nContent-Length: %zu\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
    code, code==200?"OK":"ERR", ct, len);
  sendAll(fd,(uint8_t*)head,(size_t)n);
  if(body && len) sendAll(fd,body,len);
}

static void httpServer(){
  int srv=socket(AF_INET,SOCK_STREAM,0);
  int one=1; setsockopt(srv,SOL_SOCKET,SO_REUSEADDR,&one,sizeof(one));
  sockaddr_in addr{}; addr.sin_family=AF_INET; addr.sin_port=htons(HTTP_PORT);
  addr.sin_addr.s_addr=htonl(INADDR_ANY);
  if(bind(srv,(sockaddr*)&addr,sizeof(addr))!=0){ fprintf(stderr,"[View] bind %d failed: %s\n",HTTP_PORT,strerror(errno)); return; }
  if(listen(srv,16)!=0){ fprintf(stderr,"[View] listen failed\n"); return; }
  printf("[View] HTTP viewer on http://0.0.0.0:%d/  (mock=%d)\n", HTTP_PORT, MOCK?1:0);
  fflush(stdout);
  while(g_running.load()){
    int c=accept(srv,nullptr,nullptr);
    if(c<0) continue;
    std::thread([c]{
      char buf[1024];
      ssize_t r=recv(c,buf,sizeof(buf)-1,0);
      if(r<=0){ close(c); return; }
      buf[r]=0;
      // parse first line: GET /path
      char path[256]=""; 
      sscanf(buf,"GET %255s",path);
      if(strcmp(path,"/")==0 || strncmp(path,"/?",2)==0){
        const char* html =
"<!doctype html><html><head><meta charset=utf8><title>Bot View</title>"
"<style>body{margin:0;background:#111;color:#eee;font-family:monospace}"
"#v{width:100%;height:100vh;object-fit:contain;image-rendering:pixelated;background:#000}</style></head>"
"<body><img id=v src=/frame><div id=s style=position:fixed;top:4px;left:6px;font-size:12px></div>"
"<script>const v=document.getElementById('v'),s=document.getElementById('s');"
"setInterval(()=>{v.src='/frame?'+Date.now();},140);"
"setInterval(()=>{fetch('/state').then(r=>r.text()).then(t=>s.textContent=t).catch(()=>{});},1000);"
"</script></body></html>";
        httpReply(c,200,"text/html; charset=utf8",(const uint8_t*)html,strlen(html));
      } else if(strncmp(path,"/frame",6)==0){
        std::vector<uint8_t> bmp;
        int W,H;
        { std::lock_guard<std::mutex> lk(g_fb_mtx); W=g_fbW; H=g_fbH; if(!g_fb.empty()) bmp=toBmp(g_fb,W,H); }
        if(bmp.empty()) httpReply(c,200,"image/bmp",nullptr,0);
        else httpReply(c,200,"image/bmp",bmp.data(),bmp.size());
      } else if(strcmp(path,"/state")==0){
        Frame f; { std::lock_guard<std::mutex> lk(g_mtx); f=g_frame; }
        char js[256];
        int n=snprintf(js,sizeof(js),
          "fps=%d eye=%.1f,%.1f,%.1f yaw=%.2f grid=%dx%dx%d ents=%zu",
          g_fps.load(), f.eye[0],f.eye[1],f.eye[2], f.yaw, f.W,f.H,f.D, f.ents.size());
        httpReply(c,200,"text/plain",(const uint8_t*)js,(size_t)n);
      } else {
        httpReply(c,404,"text/plain",(const uint8_t*)"404",3);
      }
      close(c);
    }).detach();
  }
  close(srv);
}

int main(int argc,char**argv){
  for(int i=1;i<argc;++i){
    std::string a=argv[i];
    if(a=="--mock") MOCK=true;
    else if(a=="--frame-host"&&i+1<argc) FRAME_HOST=argv[++i];
    else if(a=="--frame-port"&&i+1<argc) FRAME_PORT=atoi(argv[++i]);
    else if(a=="--http-port"&&i+1<argc) HTTP_PORT=atoi(argv[++i]);
    else if(a=="--w"&&i+1<argc) RES_W=atoi(argv[++i]);
    else if(a=="--h"&&i+1<argc) RES_H=atoi(argv[++i]);
  }
  g_fb.assign((size_t)RES_W*RES_H*3, 0);
  std::thread(httpServer).detach();
  if(!MOCK) std::thread(frameClient).detach();
  std::thread(renderer).detach();
  printf("[View] bot_view starting (res %dx%d, frame %s:%d, http %d, mock=%d)\n",
    RES_W,RES_H,FRAME_HOST.c_str(),FRAME_PORT,HTTP_PORT,MOCK?1:0);
  fflush(stdout);
  while(g_running.load()) std::this_thread::sleep_for(std::chrono::seconds(1));
  return 0;
}
