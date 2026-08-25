# Checklist pré-deploy

## 1. Backup do Firestore

- [ ] Exportar o projeto `rifa-belo` para um bucket do Cloud Storage.
- [ ] Confirmar que o export foi concluído sem erros.
- [ ] Guardar o caminho e a data do backup.
- [ ] Não executar importação ou restauração durante esta etapa.

Comando exemplo:

```powershell
gcloud firestore export gs://NOME_DO_BUCKET/backups/AAAA-MM-DD --project=rifa-belo
```

## 2. Confirmar os dados existentes

- [ ] No Firestore, confirmar que os dados estão no caminho:

```text
artifacts/belo-rifa-app/public/data/raffleTickets/main
artifacts/belo-rifa-app/public/data/raffleSettings/main
```

- [ ] Abrir `raffleTickets/main` e confirmar que números já vendidos continuam presentes.
- [ ] Conferir alguns números vendidos conhecidos e seus dados de comprador.
- [ ] Não excluir, renomear ou mover esses documentos.

## 3. Validar a versão local

- [ ] Executar `npm run lint`.
- [ ] Executar `npm run build`.
- [ ] Abrir a versão local e confirmar que os números vendidos aparecem bloqueados.
- [ ] Selecionar números disponíveis e confirmar que o carrinho calcula o valor correto.
- [ ] Testar o login e logout do administrador.

## 4. Segurança do Firestore

- [ ] Revisar as regras no Firebase Console.
- [ ] Usuários anônimos devem conseguir apenas ler configurações e bilhetes.
- [ ] Usuários anônimos não devem conseguir gravar, editar ou apagar bilhetes.
- [ ] Alterações administrativas devem ser permitidas somente para administradores autorizados.
- [ ] Confirmar que não existem regras temporárias em modo aberto.

## 5. Pagamento

- [ ] Não disponibilizar o botão de pagamento simulado em produção.
- [ ] Confirmar pagamento somente por integração real com Mercado Pago e webhook no backend.
- [ ] O backend deve validar valor, status aprovado e números antes de registrar a venda.
- [ ] Registrar um identificador único da transação para evitar duplicidade.

## 6. Publicação gradual

- [ ] Publicar a versão somente depois do backup e da conferência dos caminhos.
- [ ] Abrir a URL de produção em uma janela anônima.
- [ ] Confirmar novamente alguns números vendidos.
- [ ] Fazer uma compra de teste controlada, se o pagamento real estiver configurado.
- [ ] Monitorar erros do Firebase e as vendas após a publicação.
- [ ] Manter a versão anterior disponível para rollback.

## Critério para interromper o deploy

Interrompa a publicação se os números vendidos não aparecerem, se o caminho do Firestore for diferente de `belo-rifa-app`, se as regras permitirem escrita anônima ou se o pagamento ainda estiver em modo de simulação.
