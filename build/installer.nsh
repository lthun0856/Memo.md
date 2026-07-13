; 제거(언인스톨) 시 "메모 데이터를 지울지" 확인창을 띄우는 커스텀 스크립트
; electron-builder의 nsis.include 옵션으로 연결됨 (package.json 참고)
; 주의: 새 버전 설치할 때 내부적으로 이전 버전을 조용히 지우는 경우(업데이트)에는
;      이 확인창이 뜨면 안 되므로(안 그러면 업데이트할 때마다 메모가 지워질 위험이 있음),
;      진짜 "제거"일 때만(isUpdated가 아닐 때만) 동작하도록 함
!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION "저장하지 않은 메모까지 포함해서 이 프로그램의 메모 데이터를 전부 삭제할까요?$\r$\n(MD로 내보낸 메모는 이미 별도 폴더에 저장되어 있어 영향 없습니다)" IDYES nemo_delete_data IDNO nemo_keep_data
    nemo_delete_data:
      !ifdef APP_PACKAGE_NAME
        ; 사용자 계정 폴더(현재 사용자용)를 확실히 가리키도록 지정
        SetShellVarContext current
        ; /REBOOTOK: 일부 파일이 그 순간에 잠겨 있어서 바로 못 지워지면,
        ; 다음 재부팅 때라도 자동으로 마저 지우도록 예약함(즉시 삭제 실패해도 결국엔 지워짐)
        RMDir /r /REBOOTOK "$APPDATA\${APP_PACKAGE_NAME}"
        ; 그래도 폴더가 남아있으면(파일이 잠겨서 못 지운 경우) 태훈님이 알 수 있게 정확한 경로를 알려줌
        IfFileExists "$APPDATA\${APP_PACKAGE_NAME}\*.*" 0 nemo_data_done
          MessageBox MB_OK|MB_ICONINFORMATION "일부 파일이 사용 중이라 지금 바로 못 지웠어요.$\r$\n재부팅하면 자동으로 마저 지워지고, 급하면 이 폴더를 직접 지우셔도 됩니다:$\r$\n$APPDATA\${APP_PACKAGE_NAME}"
      !endif
      Goto nemo_data_done
    nemo_keep_data:
      ; 데이터를 지우지 않기로 했으면, 나중에 직접 백업하거나 지울 수 있도록
      ; 그 폴더를 탐색기로 바로 열어서 보여줌
      !ifdef APP_PACKAGE_NAME
        SetShellVarContext current
        ExecShell "open" "$APPDATA\${APP_PACKAGE_NAME}"
      !endif
    nemo_data_done:
  ${endIf}
!macroend
