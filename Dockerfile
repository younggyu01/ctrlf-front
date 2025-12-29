FROM nginx:stable-alpine
# 루트에 있는 dist 폴더를 복사
COPY dist /usr/share/nginx/html
# 루트 아래 nginx 폴더 안의 설정을 복사
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]